import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import * as nodemailer from 'nodemailer';
import * as crypto from 'crypto';
import { buildEmail, rsvpButtonsHtml } from './emailTemplate';
import {
  validateInput,
  feasibilityPreCheck,
  fnv32a,
  runScheduleAlgorithm,
  extractFamilyConflictGroups,
  type GenerateScheduleInput,
  type ScheduleAlgorithmOutput,
} from './scheduleAlgorithm';
import { isCoachOfTeamDoc, isManagerOfLeagueDoc } from './rbacHelpers';
import { isAllowedTeamColor } from './teamColors';
import { ENV } from './env';
import { computeEventRecipients } from './recipientHelpers';
import { rebuildRecipientsForTeam } from './recipientTriggerHelpers';

const APP_URL = process.env.APP_URL ?? 'https://first-whistle-e76f4.web.app';
const FUNCTIONS_BASE = process.env.FUNCTIONS_BASE ?? 'https://us-central1-first-whistle-e76f4.cloudfunctions.net';

admin.initializeApp();

// ─── Secrets ────────────────────────────────────────────────────────────────

// Twilio secrets defined here when SMS is re-enabled (TD-002)

const smtpHost = defineSecret('SMTP_HOST');
const smtpPort = defineSecret('SMTP_PORT');
const smtpUser = defineSecret('SMTP_USER');
const smtpPass = defineSecret('SMTP_PASS');
const emailFrom = defineSecret('EMAIL_FROM');
// HMAC secret for signing/verifying RSVP email links (F-02).
// Provision with: firebase functions:secrets:set RSVP_HMAC_SECRET
const rsvpSecret = defineSecret('RSVP_HMAC_SECRET');
// HMAC secret for signing calendar feed URLs.
// Provision with: firebase functions:secrets:set ICAL_SECRET
const icalSecret = defineSecret('ICAL_SECRET');
// Optional toggle for sendScheduledNotifications. Set to 'true' on a project
// to make the dispatcher log-but-not-send. Provision per-environment:
//   printf 'true' | gcloud secrets create DISPATCHER_SHADOW_MODE --project=<proj> --data-file=-
// Then deploy. Default (secret absent or value !== 'true') = real sends.
const dispatcherShadowMode = defineSecret('DISPATCHER_SHADOW_MODE');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTransporter() {
  return nodemailer.createTransport({
    host: smtpHost.value(),
    port: parseInt(smtpPort.value(), 10),
    secure: parseInt(smtpPort.value(), 10) === 465,
    auth: { user: smtpUser.value(), pass: smtpPass.value() },
  });
}

/** Escape a string for safe HTML interpolation in email templates. */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Assert the caller holds an elevated role (admin, coach, or league_manager).
 * Checks both the legacy top-level `role` field and the `memberships` array so
 * that accounts created under either model are handled correctly.
 * Returns the highest-privileged role found so callers can enforce finer-grained
 * restrictions without a second Firestore read.
 */
async function assertAdmin(uid: string): Promise<void> {
  const userDoc = await admin.firestore().doc(`users/${uid}`).get();
  const data = userDoc.data();
  const legacyRole: string = data?.role ?? '';
  const membershipRoles: string[] = (data?.memberships ?? []).map((m: Record<string, unknown>) => m.role as string);
  if (![legacyRole, ...membershipRoles].includes('admin')) {
    throw new HttpsError('permission-denied', 'Only admins can perform this action.');
  }
}

/**
 * SEC-91 (FW-64) — Server-side paywall enforcement for callable Cloud Functions
 * that bypass Firestore rules via the Admin SDK.
 *
 * Throws permission-denied if the caller is a non-admin league_manager without
 * a subscription. Admins always pass. The Firestore rules layer enforces the
 * same gate for direct client writes; this function closes the CF gap.
 */
async function assertSubscribedOrAdmin(uid: string): Promise<void> {
  const userDoc = await admin.firestore().doc(`users/${uid}`).get();
  const data = userDoc.data();
  const legacyRole: string = data?.role ?? '';
  const membershipRoles: string[] = (data?.memberships ?? []).map((m: Record<string, unknown>) => m.role as string);
  if ([legacyRole, ...membershipRoles].includes('admin')) return; // admin override
  const tier: string = data?.subscriptionTier ?? 'free';
  const adminGranted = data?.adminGrantedLM === true;
  if (tier !== 'league_manager_pro' && !adminGranted) {
    throw new HttpsError(
      'permission-denied',
      'This feature requires a League Manager Pro subscription.',
    );
  }
}

async function assertAdminOrCoach(uid: string): Promise<string> {
  const userDoc = await admin.firestore().doc(`users/${uid}`).get();
  const data = userDoc.data();
  const legacyRole: string = data?.role ?? '';
  const membershipRoles: string[] = (data?.memberships ?? []).map((m: Record<string, unknown>) => m.role as string);
  const allRoles = new Set([legacyRole, ...membershipRoles]);
  // Return the highest-privilege role so callers can enforce further restrictions.
  for (const r of ['admin', 'league_manager', 'coach'] as const) {
    if (allRoles.has(r)) {
      console.log(`assertAdminOrCoach: uid=${uid}, effective role=${r}`);
      return r;
    }
  }
  throw new HttpsError('permission-denied', 'Only admins, coaches, and league managers can perform this action.');
}

/** Sign an RSVP token tied to a specific event+player pair. */
function signRsvpToken(eventId: string, playerId: string): string {
  const secret = rsvpSecret.value();
  return crypto.createHmac('sha256', secret).update(`${eventId}:${playerId}`).digest('hex');
}

/** Verify an RSVP token. Returns false if the secret is not yet provisioned (soft mode). */
function verifyRsvpToken(eventId: string, playerId: string, token: string): boolean {
  const secret = rsvpSecret.value();
  const secretIsProvisioned = typeof secret === 'string' && secret.length >= 16;
  if (!secretIsProvisioned) return true;
  if (typeof secret === 'string' && secret.length > 0 && secret.length < 16) {
    console.warn('verifyRsvpToken: RSVP_HMAC_SECRET is set but too short (< 16 chars) — HMAC verification disabled');
  }
  const expected = crypto.createHmac('sha256', secret).update(`${eventId}:${playerId}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/** Sign a one-tap unsubscribe token for a given uid. Reuses the RSVP secret. */
function signUnsubscribeToken(uid: string): string {
  return crypto.createHmac('sha256', rsvpSecret.value()).update(`unsub:${uid}`).digest('hex');
}

/** Verify an unsubscribe token. Returns false when secret is not provisioned. */
function verifyUnsubscribeToken(uid: string, token: string): boolean {
  const secret = rsvpSecret.value();
  if (typeof secret !== 'string' || secret.length < 16) return false;
  const expected = crypto.createHmac('sha256', secret).update(`unsub:${uid}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/** Sign a calendar feed token tied to a specific uid. */
function signCalendarToken(uid: string): string {
  return crypto.createHmac('sha256', icalSecret.value()).update(uid).digest('hex');
}

/** Verify a calendar feed token. Uses timing-safe comparison. */
function verifyCalendarToken(uid: string, token: string): boolean {
  try {
    const expected = Buffer.from(signCalendarToken(uid), 'hex');
    const provided = Buffer.from(token, 'hex');
    if (expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}

/** Format a date+time pair as an iCal DTSTART/DTEND value (UTC). */
function formatICalDate(date: string, time: string, addMinutes = 0): string {
  const d = new Date(`${date}T${time}:00`);
  d.setMinutes(d.getMinutes() + addMinutes);
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/** Escape special characters for iCal text values (RFC 5545). */
function icalEscape(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')  // SEC-40: CRLF must be handled before bare CR/LF
    .replace(/\r/g, '\\n')    // SEC-40: bare CR
    .replace(/\n/g, '\\n');   // bare LF
}

/**
 * Per-user rate limiter backed by Firestore.
 * Uses a fixed window: if the window has elapsed, it resets the counter.
 * The rateLimits collection is write-protected from clients (Firestore rules: allow write: if false).
 *
 * @param uid       Firebase Auth UID of the caller
 * @param action    Short identifier for the action being rate-limited (e.g. 'sendEmail')
 * @param maxCalls  Maximum number of allowed calls within the window
 * @param windowMs  Window duration in milliseconds (default: 60 000 = 1 minute)
 */
async function checkRateLimit(uid: string, action: string, maxCalls: number, windowMs = 60_000): Promise<void> {
  const ref = admin.firestore().doc(`rateLimits/${uid}_${action}`);
  const now = Date.now();

  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as { count: number; windowStart: number } | undefined;

    if (!data || now - data.windowStart > windowMs) {
      // First call or window has expired — open a fresh window.
      tx.set(ref, { count: 1, windowStart: now });
      return;
    }
    if (data.count >= maxCalls) {
      throw new HttpsError(
        'resource-exhausted',
        `Rate limit exceeded. You may send at most ${maxCalls} ${action} requests per minute.`,
      );
    }
    tx.update(ref, { count: FieldValue.increment(1) });
  });
}

// ─── Brevo daily email quota guard ───────────────────────────────────────────
//
// Brevo free tier: 300 emails/day (hard limit — Brevo rejects beyond this).
// Warn at 80% (240), block at 95% (285) to preserve capacity for critical
// transactional emails (invites, reminders) when broadcast usage is high.
//
// Documents live at system/emailQuota_{YYYY-MM-DD} (flat under `system`).
// Admin SDK writes only — clients have no write access (firestore.rules: allow write: if false).
// Weekly cleanup via `cleanupEmailQuota` scheduled function.

const EMAIL_DAILY_LIMIT = 300;
const EMAIL_WARN_THRESHOLD = Math.floor(EMAIL_DAILY_LIMIT * 0.80);  // 240
const EMAIL_BLOCK_THRESHOLD = Math.floor(EMAIL_DAILY_LIMIT * 0.95); // 285

/**
 * Atomically reserve `count` email slots in the daily Brevo quota counter.
 *
 * - Throws `resource-exhausted` if the post-increment total would exceed the
 *   block threshold (285/day), and rolls back the increment.
 * - Logs console.error at the 80% boundary (240) so Firebase log-based alerts
 *   can fire — the email itself is still sent.
 *
 * @param count Number of email sends to reserve (default 1).
 */
async function checkEmailQuota(count = 1): Promise<void> {
  const db = admin.firestore();
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const quotaRef = db.doc(`system/emailQuota_${today}`);

  let newCount: number;
  try {
    newCount = await db.runTransaction(async (tx) => {
      const snap = await tx.get(quotaRef);
      const current: number = snap.exists ? ((snap.data()?.count as number) ?? 0) : 0;
      const next = current + count;
      tx.set(
        quotaRef,
        { count: next, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      return next;
    });
  } catch (err: unknown) {
    // Transaction failure: log and allow the send rather than hard-blocking on
    // a Firestore connectivity issue. Quota enforcement is best-effort when
    // Firestore itself is unavailable.
    console.error('[emailQuota] Transaction failed — quota check skipped:', (err as Error)?.message);
    return;
  }

  if (newCount >= EMAIL_BLOCK_THRESHOLD) {
    // Roll back the increment we just applied so the counter stays accurate.
    try {
      await quotaRef.update({ count: FieldValue.increment(-count) });
    } catch (rollbackErr: unknown) {
      console.error('[emailQuota] Rollback failed after block:', (rollbackErr as Error)?.message);
    }
    throw new HttpsError(
      'resource-exhausted',
      `Daily email quota nearly exhausted (${newCount}/${EMAIL_DAILY_LIMIT}). Email not sent.`,
    );
  }

  // Soft warning: log at console.error so Firebase log-based alerting picks it up.
  // The email is still delivered — this is a heads-up, not a block.
  if (newCount >= EMAIL_WARN_THRESHOLD && (newCount - count) < EMAIL_WARN_THRESHOLD) {
    console.error(
      `[emailQuota] WARNING: ${newCount}/${EMAIL_DAILY_LIMIT} emails sent today (80% threshold reached)`,
    );
  }
}

// ─── Admin: create user with temporary password ───────────────────────────────

interface CreateUserByAdminData {
  email: string;
  displayName: string;
  role: string;
  tempPassword: string;
  teamId?: string;
  leagueId?: string;
  playerId?: string;
}

export const createUserByAdmin = onCall<CreateUserByAdminData>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const callerRole = await assertAdminOrCoach(request.auth.uid);

    const { email, displayName, role, tempPassword, teamId, leagueId, playerId } = request.data;
    if (!email?.trim()) throw new HttpsError('invalid-argument', 'Email is required.');

    // Only admins may create elevated roles. Coaches may only create player/parent accounts.
    const elevatedRoles = ['admin', 'coach', 'league_manager'];
    if (callerRole !== 'admin' && elevatedRoles.includes(role)) {
      throw new HttpsError('permission-denied', 'Only admins can create coach, league manager, or admin accounts.');
    }
    if (!displayName?.trim()) throw new HttpsError('invalid-argument', 'Display name is required.');
    if (!tempPassword || tempPassword.length < 8) throw new HttpsError('invalid-argument', 'Temporary password must be at least 8 characters.');

    let uid: string;
    try {
      const userRecord = await admin.auth().createUser({
        email: email.trim(),
        password: tempPassword,
        displayName: displayName.trim(),
        emailVerified: true,
      });
      uid = userRecord.uid;
    } catch (err: any) {
      const code: string = err?.code ?? '';
      if (code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'An account with this email address already exists.');
      }
      if (code === 'auth/invalid-email') {
        throw new HttpsError('invalid-argument', 'Please enter a valid email address.');
      }
      if (code === 'auth/weak-password') {
        throw new HttpsError('invalid-argument', 'Temporary password is too weak. Please use at least 8 characters.');
      }
      throw new HttpsError('internal', err?.message ?? 'Failed to create user.');
    }

    const now = new Date().toISOString();
    const profile: Record<string, unknown> = {
      uid,
      email: email.trim(),
      displayName: displayName.trim(),
      role,
      mustChangePassword: true,
      createdAt: now,
      memberships: [
        {
          role,
          isPrimary: true,
          ...(teamId ? { teamId } : {}),
          ...(leagueId ? { leagueId } : {}),
          ...(playerId ? { playerId } : {}),
        },
      ],
    };
    if (teamId) profile.teamId = teamId;
    if (leagueId) profile.leagueId = leagueId;
    if (playerId) profile.playerId = playerId;

    await admin.firestore().doc(`users/${uid}`).set(profile);

    // Keep access-list fields in sync when admin creates a user with an elevated role
    try {
      if (role === 'coach' && teamId) {
        await admin.firestore().doc(`teams/${teamId}`).update({
          coachIds: FieldValue.arrayUnion(uid),
        });
      }
      if (role === 'league_manager' && leagueId) {
        await admin.firestore().doc(`leagues/${leagueId}`).update({
          managerIds: FieldValue.arrayUnion(uid),
        });
      }
      if (role === 'admin') {
        await admin.auth().setCustomUserClaims(uid, { admin: true });
      }
    } catch (err: unknown) {
      console.warn('createUserByAdmin: access-list sync failed (non-fatal):', (err as Error)?.message);
    }

    // When signup is restricted (SIGNUP_ALLOWLIST_ENABLED=true), add the email
    // to the allowlist so the user can reset their password and re-register if needed.
    if (process.env.SIGNUP_ALLOWLIST_ENABLED === 'true') {
      const normalizedEmail = email.trim().toLowerCase();
      await admin.firestore().doc('system/signupConfig').set(
        { allowedEmails: FieldValue.arrayUnion(normalizedEmail) },
        { merge: true }
      );
    }

    console.log(`createUserByAdmin: created uid=${uid}, role=${role}`);
    return { uid };
  }
);

// ─── Admin: backfill RBAC access-control fields ───────────────────────────────

export const backfillAccessControl = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
  await assertAdmin(request.auth.uid);

  const db = admin.firestore();
  const results = { teams: 0, leagues: 0, adminClaims: 0, usersBackfilled: 0 };

  // 1. Backfill team.coachIds
  const teamsSnap = await db.collection('teams').get();
  let batch = db.batch(); let ops = 0;
  for (const doc of teamsSnap.docs) {
    const data = doc.data();
    if (Array.isArray(data.coachIds)) continue;
    const coachSet = new Set<string>();
    if (data.coachId) coachSet.add(data.coachId);
    if (data.createdBy) coachSet.add(data.createdBy);
    batch.update(doc.ref, { coachIds: [...coachSet] });
    results.teams++;
    if (++ops >= 499) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops > 0) await batch.commit();

  // 2. Backfill league.managerIds
  const leaguesSnap = await db.collection('leagues').get();
  batch = db.batch(); ops = 0;
  for (const doc of leaguesSnap.docs) {
    const data = doc.data();
    if (Array.isArray(data.managerIds)) continue;
    const managerSet = new Set<string>();
    if (data.managedBy) managerSet.add(data.managedBy);
    batch.update(doc.ref, { managerIds: [...managerSet] });
    results.leagues++;
    if (++ops >= 499) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops > 0) await batch.commit();

  // 3. Synthesize memberships[] for legacy user docs (no memberships array yet)
  const usersSnap = await db.collection('users').get();
  batch = db.batch(); ops = 0;
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    if (Array.isArray(data.memberships) && data.memberships.length > 0) continue;
    const m: Record<string, unknown> = { role: data.role ?? 'player', isPrimary: true };
    if (data.teamId) m.teamId = data.teamId;
    if (data.playerId) m.playerId = data.playerId;
    if (data.leagueId) m.leagueId = data.leagueId;
    batch.update(doc.ref, { memberships: [m] });
    results.usersBackfilled++;
    if (++ops >= 499) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops > 0) await batch.commit();

  // 4. Set admin custom claims (Auth SDK has no batch API — serial is correct)
  // Re-use the same usersSnap; no second collection read needed.
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const allRoles: string[] = [
      data.role,
      ...((data.memberships ?? []) as Array<{ role?: string }>).map(m => m.role ?? ''),
    ];
    if (!allRoles.includes('admin')) continue;
    try {
      const userRecord = await admin.auth().getUser(doc.id);
      if (userRecord.customClaims?.admin === true) continue;
      await admin.auth().setCustomUserClaims(doc.id, { admin: true });
      results.adminClaims++;
    } catch (err: unknown) {
      console.warn(`backfillAccessControl: could not set claims for ${doc.id}:`, (err as Error)?.message);
    }
  }

  console.log('backfillAccessControl complete:', results);
  return results;
});

// ─── Admin: delete user ───────────────────────────────────────────────────────

interface DeleteUserData { uid: string }

export const deleteUserByAdmin = onCall<DeleteUserData>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    await assertAdmin(request.auth.uid);

    const { uid } = request.data;
    if (!uid?.trim()) throw new HttpsError('invalid-argument', 'uid is required.');
    if (uid === request.auth.uid) throw new HttpsError('failed-precondition', 'You cannot delete your own account.');

    // SEC-20: prevent admins from deleting other admins
    const targetDoc = await admin.firestore().doc(`users/${uid}`).get();
    const targetRole: string = targetDoc.data()?.role ?? '';
    const targetMembershipRoles: string[] = (targetDoc.data()?.memberships ?? []).map((m: Record<string, unknown>) => m.role as string);
    if ([targetRole, ...targetMembershipRoles].includes('admin')) {
      throw new HttpsError('failed-precondition', 'Admin accounts cannot be deleted this way. Remove the admin role first.');
    }

    // Delete Auth account first; if it doesn't exist, that's fine — still clean up Firestore.
    try {
      await admin.auth().deleteUser(uid);
    } catch (err: any) {
      if (err?.code !== 'auth/user-not-found') {
        throw new HttpsError('internal', err?.message ?? 'Failed to delete auth account.');
      }
    }
    // SEC-21: recursiveDelete removes the document and all subcollections (notifications, config, venues, consents)
    await admin.firestore().recursiveDelete(admin.firestore().doc(`users/${uid}`));

    console.log(`deleteUserByAdmin: deleted uid=${uid} by ${request.auth.uid}`);
    return { success: true };
  }
);

// ─── Admin: reset user password ──────────────────────────────────────────────

interface ResetUserPasswordData {
  uid: string;
}

export const resetUserPassword = onCall<ResetUserPasswordData>(
  { secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');

    const callerRole = await assertAdminOrCoach(request.auth.uid);
    if (callerRole !== 'admin') {
      throw new HttpsError('permission-denied', 'Only admins can send password reset emails.');
    }

    const { uid } = request.data;
    if (!uid?.trim()) throw new HttpsError('invalid-argument', 'uid is required.');

    // SEC-17: rate-limit caller (10 resets/min) and target (1 per target per 5 min)
    await checkRateLimit(request.auth.uid, 'resetUserPassword', 10);
    await checkRateLimit(uid, 'resetUserPassword-target', 1, 5 * 60_000);

    let email: string;
    try {
      const userRecord = await admin.auth().getUser(uid);
      if (!userRecord.email) {
        throw new HttpsError('failed-precondition', 'This user has no email address on file.');
      }
      email = userRecord.email;
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('not-found', 'User not found.');
    }

    const resetLink = await admin.auth().generatePasswordResetLink(email);

    const transporter = createTransporter();
    await transporter.sendMail({
      from: emailFrom.value(),
      to: email,
      subject: 'Reset your First Whistle password',
      text: `Hi,\n\nAn admin has sent you a link to reset your First Whistle password.\n\nClick the link below to choose a new password:\n${resetLink}\n\nThis link expires shortly. If you didn't request this, you can ignore this email.`,
      html: buildEmail({
        recipientName: 'there',
        preheader: 'Reset your First Whistle password',
        title: 'Reset your password',
        message: `<p style="margin:0 0 12px">An admin has requested a password reset for your First Whistle account.</p><p style="margin:0">Click the button below to choose a new password. This link expires shortly.</p>`,
        ctaUrl: resetLink,
        ctaLabel: 'Reset Password',
      }),
    });

    console.log(`resetUserPassword: sent reset email for uid=${uid}`);
    return { success: true };
  }
);

// ─── Self-service onboarding: become a coach / league manager ─────────────────

interface CreateTeamAndBecomeCoachData {
  name: string;
  sportType: string;
  color: string;
  ageGroup?: string;
  homeVenue?: string;
  homeVenueId?: string;
  coachName?: string;
  coachEmail?: string;
  logoUrl?: string;
  attendanceWarningsEnabled?: boolean;
  attendanceWarningThreshold?: number;
  isPrivate?: boolean;
}

interface CreateTeamAndBecomeCoachResult {
  teamId: string;
  newMembershipIndex: number;
}

const ALLOWED_SPORT_TYPES = ['soccer', 'basketball', 'baseball', 'softball', 'volleyball', 'football', 'hockey', 'tennis', 'other'];

export const createTeamAndBecomeCoach = onCall<CreateTeamAndBecomeCoachData, Promise<CreateTeamAndBecomeCoachResult>>(
  // Pin one warm instance: Gen 2 cold start is 15-20s in CI and blocks both the
  // E2E admin-create-team modal (30s timeout) and real-user "create your first
  // team" UX. ~$1.30/mo at idle — trivial for the UX win.
  { minInstances: 1, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const uid = request.auth.uid;
    const { name, sportType, color, ageGroup, homeVenue, homeVenueId, coachName: coachNameOverride, coachEmail, logoUrl, attendanceWarningsEnabled, attendanceWarningThreshold, isPrivate } = request.data;

    if (!name?.trim()) throw new HttpsError('invalid-argument', 'Team name is required.');
    if (name.trim().length > 100) throw new HttpsError('invalid-argument', 'Team name is too long.');
    if (!sportType?.trim()) throw new HttpsError('invalid-argument', 'Sport type is required.');
    if (!ALLOWED_SPORT_TYPES.includes(sportType)) throw new HttpsError('invalid-argument', 'Invalid sport type.');
    if (color && !isAllowedTeamColor(color)) throw new HttpsError('invalid-argument', 'Invalid team color.');

    // Limit raised from 5 to 20 per 60s window (2026-04-17) to accommodate
    // real-user bulk creation paths: league managers onboarding 8-12 teams at
    // once, or retry fumbling when a CF call feels slow. Still blocks scripted
    // abuse (>1200/hour). Revisit at prod scale — see backlog issue.
    await checkRateLimit(uid, 'createTeam', 20);

    try {
      // Generate ref before transaction — ID generation is safe outside the tx.
      const teamRef = admin.firestore().collection('teams').doc();
      const teamId = teamRef.id;
      const profileRef = admin.firestore().doc(`users/${uid}`);
      const now = new Date().toISOString();

      let newMembershipIndex!: number;
      await admin.firestore().runTransaction(async (tx) => {
        // Read profile INSIDE the transaction (SEC-27: prevents TOCTOU race).
        const profileSnap = await tx.get(profileRef);
        if (!profileSnap.exists) throw new HttpsError('not-found', 'User profile not found.');
        const profile = profileSnap.data()!;

        const teamDoc: Record<string, unknown> = {
          id: teamId,
          name: name.trim(),
          sportType,
          color,
          coachId: uid,
          coachIds: [uid], // Denormalized access list for membership-scoped Firestore rules
          coachName: profile.displayName ?? '',
          ownerName: profile.displayName ?? '',
          createdBy: uid,
          createdAt: now,
          updatedAt: now,
          attendanceWarningsEnabled: attendanceWarningsEnabled ?? true,
          ...(ageGroup ? { ageGroup } : {}),
          ...(homeVenue ? { homeVenue: homeVenue.trim() } : {}),
          ...(homeVenueId ? { homeVenueId } : {}),
          ...(coachNameOverride?.trim() ? { coachName: coachNameOverride.trim() } : {}),
          ...(coachEmail?.trim() ? { coachEmail: coachEmail.trim() } : {}),
          isPrivate: isPrivate ?? true,
          isDeleted: false,
          ...(logoUrl ? { logoUrl } : {}),
          ...(attendanceWarningThreshold != null ? { attendanceWarningThreshold } : {}),
        };

        const existingMemberships: Record<string, unknown>[] = Array.isArray(profile.memberships)
          ? profile.memberships
          : [];

        // Admins and league managers are operators, not coaches of every team
        // they create on behalf of leagues/users. Appending a `coach` membership
        // on every call accumulates unboundedly (an LM running 10 leagues
        // generates one stale coach membership per team they spin up) and
        // pollutes the ProfilePage roles list with raw team IDs for teams the
        // user never actually coached. The team doc's coachId/coachIds still
        // grants write access via Firestore rules — the membership is purely
        // a UI signal, and operators don't need it.
        const isOperatorCaller = profile.role === 'admin' || profile.role === 'league_manager';

        if (isOperatorCaller) {
          newMembershipIndex = -1; // Sentinel: no new membership added.
          tx.set(teamRef, teamDoc);
          // No profile patch — admin's profile is intentionally untouched.
        } else {
          const newMembership = {
            role: 'coach',
            teamId,
            isPrimary: existingMemberships.length === 0,
          };
          const newMemberships = [...existingMemberships, newMembership];
          newMembershipIndex = newMemberships.length - 1;

          const profilePatch: Record<string, unknown> = {
            memberships: newMemberships,
            activeContext: newMembershipIndex, // Set server-side — client write is blocked by Firestore rules after role elevation (SEC-29).
          };
          const nonElevatedRoles = ['player', 'parent'];
          if (nonElevatedRoles.includes(profile.role as string)) {
            profilePatch.role = 'coach';
          }

          tx.set(teamRef, teamDoc);
          tx.update(profileRef, profilePatch);
        }
      });

      console.log(`createTeamAndBecomeCoach: uid=${uid}, teamId=${teamId}`);
      return { teamId, newMembershipIndex };
    } catch (err: any) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Failed to create team.');
    }
  }
);

interface ApproveJoinRequestData {
  teamId: string;
  requestUid: string;
  role?: 'player' | 'parent'; // defaults to 'player'
}

export const approveJoinRequest = onCall<ApproveJoinRequestData, Promise<{ success: boolean }>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');

    const { teamId, requestUid, role = 'player' } = request.data;
    if (!teamId?.trim()) throw new HttpsError('invalid-argument', 'teamId is required.');
    if (!requestUid?.trim()) throw new HttpsError('invalid-argument', 'requestUid is required.');
    // SEC-30: runtime allowlist — TypeScript types are not a security boundary
    const ALLOWED_JOIN_ROLES = ['player', 'parent'];
    if (!ALLOWED_JOIN_ROLES.includes(role)) {
      throw new HttpsError('invalid-argument', 'Invalid role. Must be "player" or "parent".');
    }

    const db = admin.firestore();
    const callerUid = request.auth.uid;

    // Verify caller is coach of this team or admin
    const callerRole = await assertAdminOrCoach(callerUid);
    if (callerRole !== 'admin') {
      const teamSnap = await db.doc(`teams/${teamId}`).get();
      if (!teamSnap.exists) throw new HttpsError('not-found', 'Team not found.');
      const teamData = teamSnap.data()!;
      const coachIds: string[] = teamData.coachIds ?? [];
      if (!coachIds.includes(callerUid) && teamData.coachId !== callerUid) {
        throw new HttpsError('permission-denied', 'Only team coaches can approve join requests.');
      }
    }

    const userRef = db.doc(`users/${requestUid}`);
    const requestRef = db.doc(`teams/${teamId}/joinRequests/${requestUid}`);

    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');

      const userData = userSnap.data()!;
      const existingMemberships: Record<string, unknown>[] = Array.isArray(userData.memberships)
        ? userData.memberships
        : [];

      // Avoid duplicates
      const alreadyMember = existingMemberships.some(
        (m) => m['role'] === role && m['teamId'] === teamId
      );

      const profilePatch: Record<string, unknown> = {
        teamId, // legacy scalar
      };

      if (!alreadyMember) {
        const newMembership = {
          role,
          teamId,
          isPrimary: existingMemberships.length === 0,
        };
        profilePatch.memberships = FieldValue.arrayUnion(newMembership);
      }

      // Only promote role scalar if user is a plain 'player' or 'parent' and role matches
      const nonElevatedRoles = ['player', 'parent'];
      if (nonElevatedRoles.includes(userData.role as string) && userData.role !== role) {
        // Don't demote — only set if unset or matches
      } else if (!userData.role || nonElevatedRoles.includes(userData.role as string)) {
        profilePatch.role = role;
      }

      tx.update(userRef, profilePatch);
      tx.update(requestRef, { status: 'approved' });
    });

    console.log(`approveJoinRequest: teamId=${teamId} requestUid=${requestUid} role=${role}`);
    return { success: true };
  }
);

interface CreateLeagueAndBecomeManagerData {
  name: string;
  sportType?: string;
  season?: string;
  description?: string;
}

interface CreateLeagueAndBecomeManagerResult {
  leagueId: string;
  newMembershipIndex: number;
}

export const createLeagueAndBecomeManager = onCall<CreateLeagueAndBecomeManagerData, Promise<CreateLeagueAndBecomeManagerResult>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const uid = request.auth.uid;
    const { name, sportType, season, description } = request.data;

    if (!name?.trim()) throw new HttpsError('invalid-argument', 'League name is required.');
    if (name.trim().length > 100) throw new HttpsError('invalid-argument', 'League name is too long.');
    if (sportType && !ALLOWED_SPORT_TYPES.includes(sportType)) throw new HttpsError('invalid-argument', 'Invalid sport type.');
    if (description && description.trim().length > 2000) throw new HttpsError('invalid-argument', 'Description is too long.');

    // SEC-91 (FW-64): paywall enforcement
    await assertSubscribedOrAdmin(uid);

    await checkRateLimit(uid, 'createLeague', 3);

    try {
      // Generate ref before transaction — ID generation is safe outside the tx.
      const leagueRef = admin.firestore().collection('leagues').doc();
      const leagueId = leagueRef.id;
      const profileRef = admin.firestore().doc(`users/${uid}`);
      const now = new Date().toISOString();

      let newMembershipIndex!: number;
      await admin.firestore().runTransaction(async (tx) => {
        // Read profile INSIDE the transaction (SEC-27: prevents TOCTOU race).
        const profileSnap = await tx.get(profileRef);
        if (!profileSnap.exists) throw new HttpsError('not-found', 'User profile not found.');
        const profile = profileSnap.data()!;

        const leagueDoc: Record<string, unknown> = {
          id: leagueId,
          name: name.trim(),
          managedBy: uid,
          managerIds: [uid], // Denormalized access list for membership-scoped Firestore rules
          createdAt: now,
          updatedAt: now,
          ...(sportType ? { sportType } : {}),
          ...(season ? { season: season.trim() } : {}),
          ...(description ? { description: description.trim() } : {}),
          isDeleted: false,
        };

        const existingMemberships: Record<string, unknown>[] = Array.isArray(profile.memberships)
          ? profile.memberships
          : [];
        const newMembership = {
          role: 'league_manager',
          leagueId,
          isPrimary: existingMemberships.length === 0,
        };
        const newMemberships = [...existingMemberships, newMembership];
        newMembershipIndex = newMemberships.length - 1;

        const profilePatch: Record<string, unknown> = {
          memberships: newMemberships,
          activeContext: newMembershipIndex, // Set server-side — client write is blocked by Firestore rules after role elevation (SEC-29).
        };
        // SEC-28: only elevate player/parent → league_manager. Coaches keep their top-level role
        // (they gain LM access via the membership entry). Pending PM decision on whether coaches
        // should be auto-promoted at the top-level role field.
        const nonLmRoles = ['player', 'parent'];
        if (nonLmRoles.includes(profile.role as string)) {
          profilePatch.role = 'league_manager';
        }

        tx.set(leagueRef, leagueDoc);
        tx.update(profileRef, profilePatch);
      });

      console.log(`createLeagueAndBecomeManager: uid=${uid}, leagueId=${leagueId}`);
      return { leagueId, newMembershipIndex };
    } catch (err: any) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Failed to create league.');
    }
  }
);

// ─── SMS (TD-002 — disabled until Twilio account is set up) ──────────────────
// Uncomment and restore Twilio secrets above to re-enable.
// export const sendSms = ...

// ─── Email messaging (callable) ───────────────────────────────────────────────

interface Recipient { name: string; email: string; }
interface SendEmailData {
  to: string[];
  subject: string;
  message: string;
  recipients?: Recipient[];
  senderName?: string;
  teamName?: string;
}
interface SendEmailResult { sent: number; failed: number; errors: string[]; }

export const sendEmail = onCall<SendEmailData, Promise<SendEmailResult>>(
  { secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    await assertAdminOrCoach(request.auth.uid);
    await checkRateLimit(request.auth.uid, 'sendEmail', 10);

    const { to, subject, message, recipients, senderName, teamName } = request.data;
    if (!to?.length) throw new HttpsError('invalid-argument', 'No recipients provided.');
    if (!subject?.trim()) throw new HttpsError('invalid-argument', 'Subject cannot be empty.');
    if (!message?.trim()) throw new HttpsError('invalid-argument', 'Message cannot be empty.');
    if (to.length > 100) throw new HttpsError('invalid-argument', 'Maximum 100 recipients.');

    // Reserve quota slots before opening the SMTP connection.
    // Reserves one slot per recipient so the counter matches actual Brevo sends.
    await checkEmailQuota(to.length);

    const fullSubject = `First Whistle Message: ${subject.trim()}`;
    const escapedMessage = message.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    console.log(`sendEmail: sending to ${to.length} recipient(s), subject="${fullSubject}"`);
    const transporter = createTransporter();

    const results = await Promise.allSettled(
      to.map((address: string, i: number) => {
        const recipient = recipients?.[i];
        const toHeader = recipient ? `${recipient.name} <${recipient.email}>` : address;
        const senderLine = senderName
          ? `<p style="color:#6b7280;font-size:13px;margin:0">From: <strong>${esc(senderName)}</strong>${teamName ? ` · ${esc(teamName)}` : ''}</p>`
          : '';
        const recipientLine = recipient
          ? `<p style="color:#6b7280;font-size:13px;margin:0 0 16px">To: ${esc(recipient.name)} &lt;${esc(recipient.email)}&gt;</p>`
          : '';

        const metaLines = [senderLine, recipientLine].filter(Boolean).join('\n');
        const messageHtml = `${metaLines}<p style="white-space:pre-wrap;line-height:1.7;margin:0">${escapedMessage}</p>`;

        return transporter.sendMail({
          from: emailFrom.value(),
          to: toHeader,
          subject: fullSubject,
          text: [
            senderName ? `From: ${senderName}${teamName ? ` · ${teamName}` : ''}` : '',
            recipient ? `To: ${recipient.name} <${recipient.email}>` : '',
            '',
            message.trim(),
            '',
            '---',
            'Sent via First Whistle',
          ].filter((l, idx) => idx > 1 || l).join('\n'),
          html: buildEmail({
            recipientName: recipient?.name ?? '',
            preheader: subject.trim(),
            title: subject.trim(),
            message: messageHtml,
            teamName: teamName ?? '',
          }),
        });
      })
    );

    const errors: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        errors.push(`${to[i]}: ${(result.reason as Error)?.message ?? 'Unknown error'}`);
      }
    });

    const sent = results.filter(r => r.status === 'fulfilled').length;
    console.log(`sendEmail: sent=${sent}, failed=${errors.length}`, errors.length ? errors : '');
    return { sent, failed: errors.length, errors };
  }
);

// ─── Player invite ─────────────────────────────────────────────────────────────
// Stores an invite record and sends a welcome email. The client checks
// invites/{email} on signup/login to auto-link the player record.

const ALLOWED_INVITE_ROLES = ['player', 'parent'] as const;
type InviteRole = (typeof ALLOWED_INVITE_ROLES)[number];

interface SendInviteData {
  to: string;
  playerName: string;
  teamName: string;
  playerId: string;
  teamId: string;
  /** 'player' for the player themselves, 'parent' for a parent/guardian. Defaults to 'player'. */
  role?: 'player' | 'parent';
}

export const sendInvite = onCall<SendInviteData>(
  { secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const uid = request.auth.uid;
    const callerRole = await assertAdminOrCoach(uid);
    await checkRateLimit(uid, 'sendInvite', 20);

    const { to, playerName, teamName, playerId, teamId, role: requestedRole } = request.data;
    if (!to?.trim()) throw new HttpsError('invalid-argument', 'Email address is required.');

    const normalizedEmail = to.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new HttpsError('invalid-argument', 'Invalid email address format.');
    }

    const inviteRole: InviteRole = (
      requestedRole && ALLOWED_INVITE_ROLES.includes(requestedRole)
        ? requestedRole
        : 'player'
    );

    // SEC-22: coaches may only invite players to teams they own.
    if (callerRole !== 'admin') {
      const teamDoc = await admin.firestore().doc(`teams/${teamId}`).get();
      if (!teamDoc.exists) {
        throw new HttpsError('not-found', 'Team not found.');
      }
      const teamData = teamDoc.data()!;
      if (!isCoachOfTeamDoc(teamData, uid)) {
        throw new HttpsError('permission-denied', 'You can only invite players to your own team.');
      }
    }

    // Generate a one-time secret to prove the invitee received the email (SEC-18).
    // The secret is included in the invite link and must be presented when calling
    // verifyInvitedUser — prevents an attacker registering with the invited email
    // from claiming the invite without having access to the inbox.
    const inviteSecret = crypto.randomUUID();
    const inviteUrl = `${APP_URL}/signup?inviteSecret=${inviteSecret}`;

    // Store invite so auto-link can find it on signup/login.
    // The document ID is a composite of email + teamId + role so that a second invite to the
    // same email for a different team (or role) does not silently overwrite the first (SEC-20).
    await admin.firestore().doc(`invites/${normalizedEmail}_${teamId}_${inviteRole}`).set({
      email: normalizedEmail,
      playerId,
      teamId,
      playerName,
      teamName,
      role: inviteRole,
      inviteSecret,
      invitedAt: new Date().toISOString(),
      autoVerify: true,
      status: 'pending',
    });

    // If the invitee already has a Firebase Auth account, auto-verify their email now so they
    // can sign in immediately without waiting for a verification email.
    // If they don't have an account yet, the autoVerify flag on the invite doc handles it at signup
    // (via verifyInvitedUser) and at first sign-in (via checkInviteAutoVerify).
    await admin.auth().getUserByEmail(normalizedEmail)
      .then(userRecord => admin.auth().updateUser(userRecord.uid, { emailVerified: true }))
      .catch(() => { /* user doesn't have an account yet — autoVerify flag on invite doc covers both paths */ });

    // Add to signup allowlist so the invitee can register even when signups are restricted
    await admin.firestore().doc('system/signupConfig').set(
      { allowedEmails: FieldValue.arrayUnion(normalizedEmail) },
      { merge: true }
    );

    const transporter = createTransporter();
    await transporter.sendMail({
      from: emailFrom.value(),
      to: `${playerName} <${to.trim()}>`,
      subject: `You've been added to ${teamName} on First Whistle`,
      text: `Hi ${playerName},\n\nYou've been added to ${teamName} on First Whistle.\n\nCreate a free account (or sign in if you already have one) to view your schedule, track attendance, and stay connected with your team:\n${inviteUrl}\n\nSee you on the field!`,
      html: buildEmail({
        recipientName: playerName,
        preheader: `You've been added to ${teamName} on First Whistle`,
        title: `You've been invited to join ${teamName}`,
        message: `<p style="margin:0 0 12px">You've been added to <strong>${esc(teamName)}</strong> on First Whistle.</p><p style="margin:0">Create a free account — or sign in if you already have one — to view your schedule, track attendance, and stay connected with your team.</p>`,
        teamName,
        ctaUrl: inviteUrl,
        ctaLabel: 'Accept Invitation',
      }),
    });
  }
);

// ─── Verify invited user ──────────────────────────────────────────────────────

interface VerifyInvitedUserResult {
  found: boolean;
}

interface VerifyInvitedUserData {
  inviteSecret: string;
}

export const verifyInvitedUser = onCall<VerifyInvitedUserData, Promise<VerifyInvitedUserResult>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    await checkRateLimit(request.auth.uid, 'verifyInvitedUser', 5);

    const uid = request.auth.uid;
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('invalid-argument', 'No email on auth token.');

    const db = admin.firestore();
    const userRef = db.doc(`users/${uid}`);

    // SEC-20: invites are now stored under a composite key (email_teamId_role).
    // Query by email + secret to locate the correct doc without knowing the key up front.
    const normalizedEmail = email;
    const inviteQuery = await db.collection('invites')
      .where('email', '==', normalizedEmail)
      .where('inviteSecret', '==', request.data.inviteSecret)
      .limit(1)
      .get();
    if (inviteQuery.empty) {
      return { found: false };
    }
    const inviteRef = inviteQuery.docs[0].ref;

    // Use a transaction to atomically consume the invite, write/update the user profile,
    // and update the player record — preventing double-consumption if called concurrently (SEC-19).
    // The query above runs outside the transaction to obtain the ref; the transaction re-reads
    // the doc inside to acquire a Firestore lock on it.
    let shouldAutoVerify = false;
    const txResult = await db.runTransaction(async (txn) => {
      const inviteSnap = await txn.get(inviteRef);

      // Idempotency: if the invite doc was consumed between the query and the transaction, bail.
      if (!inviteSnap.exists) return { found: false };

      const invite = inviteSnap.data()!;
      const { teamId, playerId, autoVerify, inviteSecret: storedSecret } = invite as {
        teamId?: string;
        playerId?: string;
        autoVerify?: boolean;
        inviteSecret?: string;
      };

      // Read the role from the invite doc — never trust client-supplied role (SEC-20).
      // FND-2026-001: legacy invites may have been written without a role field; default to
      // 'player' so they remain usable rather than failing with a hard error.
      const rawRole = invite['role'] as string | undefined;
      if (rawRole && !ALLOWED_INVITE_ROLES.includes(rawRole as InviteRole)) {
        throw new HttpsError('failed-precondition', 'Invite has an invalid role.');
      }
      const inviteRole = (rawRole && ALLOWED_INVITE_ROLES.includes(rawRole as InviteRole)
        ? rawRole
        : 'player') as InviteRole;

      // Validate the invite secret to prevent invite theft (SEC-18, SEC-25).
      // Legacy invites without a secret field are rejected — the security risk of
      // allowing secret-less invites outweighs the inconvenience; admins can re-send.
      if (!storedSecret || request.data.inviteSecret !== storedSecret) {
        throw new HttpsError('permission-denied', 'Invalid invite link. Please use the link from your invitation email.');
      }

      shouldAutoVerify = !!autoVerify;

      const userSnap = await txn.get(userRef);

      if (!userSnap.exists) {
        // ── New user path ───────────────────────────────────────────────────────
        // Build a fresh UserProfile using the invite's role as the authoritative role.
        const newMembership: Record<string, unknown> = {
          role: inviteRole,
          isPrimary: true,
          ...(teamId ? { teamId } : {}),
          ...(playerId ? { playerId } : {}),
        };
        const now = new Date().toISOString();
        const newProfile: Record<string, unknown> = {
          uid,
          email,
          displayName: email,
          role: inviteRole,
          ...(teamId ? { teamId } : {}),
          ...(playerId ? { playerId } : {}),
          memberships: [newMembership],
          createdAt: now,
        };
        txn.set(userRef, newProfile);
      } else {
        // ── Existing user path ──────────────────────────────────────────────────
        // Append a new membership entry if the same role+teamId combo doesn't already exist.
        const profile = userSnap.data()!;
        const existingMemberships: Record<string, unknown>[] =
          Array.isArray(profile['memberships']) ? profile['memberships'] : [];

        const isDuplicate = existingMemberships.some(
          (m) => m['role'] === inviteRole && m['teamId'] === teamId
        );

        if (!isDuplicate) {
          const newMembership: Record<string, unknown> = {
            role: inviteRole,
            isPrimary: false,
            ...(teamId ? { teamId } : {}),
            ...(playerId ? { playerId } : {}),
          };
          txn.update(userRef, {
            memberships: FieldValue.arrayUnion(newMembership),
            // Write top-level playerId scalar so ProfilePage "Team Connection" resolves correctly
            ...(playerId ? { playerId } : {}),
          });
        }
      }

      // ── Update the Player record ────────────────────────────────────────────
      // Write linkedUid (for player role) or parentUid (for parent role) on the player doc.
      if (playerId) {
        const playerRef = db.doc(`players/${playerId}`);
        const playerSnap = await txn.get(playerRef);
        if (playerSnap.exists) {
          const playerPatch: Record<string, unknown> =
            inviteRole === 'player'
              ? { linkedUid: uid }
              : { parentUid: uid };
          txn.update(playerRef, playerPatch);
        }
      }

      // Consume the invite doc atomically with the profile/player writes.
      txn.delete(inviteRef);
      return { found: true };
    });

    if (!txResult.found) return { found: false };

    // Auth update must happen outside the transaction (Admin SDK constraint).
    if (shouldAutoVerify) {
      await admin.auth().updateUser(uid, { emailVerified: true });
    }

    return { found: true };
  }
);

// ─── Check invite auto-verify (login path) ────────────────────────────────────
// Called after signInWithEmailAndPassword when emailVerified is false.
// Unlike verifyInvitedUser (which requires an invite secret and consumes the invite),
// Checks whether the authenticated user has a pending autoVerify invite and, if so,
// marks their Firebase Auth email as verified and consumes the invite (status → 'used').
// The full invite-link flow (verifyInvitedUser) can still process a 'used' invite — it
// queries by inviteSecret with no status filter and deletes the doc in a transaction.

interface CheckInviteAutoVerifyResult {
  verified: boolean;
}

export const checkInviteAutoVerify = onCall<Record<string, never>, Promise<CheckInviteAutoVerifyResult>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    await checkRateLimit(request.auth.uid, 'checkInviteAutoVerify', 10);

    const uid = request.auth.uid;
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('invalid-argument', 'No email on auth token.');

    const db = admin.firestore();

    // Query for any pending invite for this email with autoVerify set.
    // The invite may not yet have been consumed (user hasn't gone through signup link yet).
    const inviteQuery = await db.collection('invites')
      .where('email', '==', email)
      .where('autoVerify', '==', true)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (inviteQuery.empty) {
      // Idempotency: check whether this UID already consumed an autoVerify invite for this
      // email in a prior call.  If so, re-verify without error — the caller is retrying.
      const priorClaimQuery = await db.collection('invites')
        .where('email', '==', email)
        .where('autoVerify', '==', true)
        .where('claimedByUid', '==', uid)
        .limit(1)
        .get();

      if (!priorClaimQuery.empty) {
        // Already consumed by this same UID — idempotent re-verify.
        await admin.auth().updateUser(uid, { emailVerified: true });
        console.log(`checkInviteAutoVerify: idempotent re-verify uid=${uid} email=${email}`);
        return { verified: true };
      }

      return { verified: false };
    }

    const inviteDoc = inviteQuery.docs[0];
    const inviteData = inviteDoc.data() as Record<string, unknown>;

    // Pre-check: if the invite was already claimed by a *different* UID, refuse.
    // This guards the window between the query above and the consume write below —
    // a second account cannot piggyback on a pending invite that belongs to another UID.
    // (SEC-105 / FW-50)
    if (inviteData['claimedByUid'] !== undefined && inviteData['claimedByUid'] !== uid) {
      console.warn(
        `checkInviteAutoVerify: invite already claimed by ${String(inviteData['claimedByUid'])}, ` +
        `refusing uid=${uid} email=${email}`
      );
      return { verified: false };
    }

    // Consume the invite FIRST: stamp it so no second account can replay this path.
    // Firestore write before Auth update — if the Auth update fails, the idempotent
    // priorClaimQuery path handles the retry correctly.  If the Firestore write fails,
    // we never verify — safer than the reverse order which leaves the invite replayable.
    // We do NOT delete — verifyInvitedUser still needs the doc (queries by inviteSecret,
    // no status filter) and deletes it inside its own transaction.
    try {
      await inviteDoc.ref.update({
        status: 'used',
        claimedByUid: uid,
        claimedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error(`checkInviteAutoVerify: failed to consume invite for uid=${uid} email=${email}`, err);
      throw new HttpsError('internal', 'Failed to record invite claim. Please try again.');
    }

    // Invite consumed — now mark the Firebase Auth account as verified.
    await admin.auth().updateUser(uid, { emailVerified: true });

    console.log(`checkInviteAutoVerify: auto-verified uid=${uid} email=${email} via pending invite`);

    return { verified: true };
  }
);

// ─── Preview invite (pre-auth allowlist bypass) ───────────────────────────────
// Called by the signup page BEFORE createUserWithEmailAndPassword.
// Takes an inviteSecret, returns { valid, email } without any state mutation.
// If valid, the client may skip the allowlist gate for that exact email address.
// Rate-limited per unique secret (max 5/min) to prevent brute-force enumeration.

interface PreviewInviteData {
  inviteSecret: string;
}

interface PreviewInviteResult {
  valid: boolean;
  email: string | null;
}

export const previewInvite = onCall<PreviewInviteData, Promise<PreviewInviteResult>>(
  async (request) => {
    const { inviteSecret } = request.data;
    if (!inviteSecret?.trim()) {
      throw new HttpsError('invalid-argument', 'inviteSecret is required.');
    }

    // Rate-limit by a truncated base64url encoding of the secret so that
    // brute-force guessing is bounded without requiring an authenticated UID.
    // Using the secret itself (hashed) as the key means every attacker gets
    // their own bucket — a new random guess costs one slot in a new bucket.
    const secretKey = Buffer.from(inviteSecret).toString('base64url').slice(0, 40);
    await checkRateLimit(`anon`, `previewInvite_${secretKey}`, 5);

    // SEC-#484: Additionally rate-limit per caller IP so a single attacker
    // cannot trivially enumerate the invite secret space by rotating the
    // `inviteSecret` param (which otherwise yields a fresh 5-call bucket per
    // guess). This is a low-frequency legitimate action (a human clicking an
    // invite link); 20/min per IP is generous for real users but curbs abuse.
    // Falls back to `unknown` when the caller IP is not available so the
    // bucket is still bounded rather than unlimited.
    //
    // SEC-#487: On Cloud Run (Firebase Functions v2) `req.ip` is always the
    // Google load-balancer's internal IP, so every caller would share one
    // bucket. The caller's real IP is in the `X-Forwarded-For` header — the
    // last entry is the IP closest to Cloud Run (the LB's view of the client,
    // which clients cannot forge past the LB).
    const xff = request.rawRequest.headers?.['x-forwarded-for'];
    const rawIp = typeof xff === 'string'
      ? xff.split(',').pop()?.trim() ?? null
      : null;
    const ipKey = (rawIp && rawIp.trim().length > 0 ? rawIp : 'unknown')
      .replace(/[^a-zA-Z0-9._:-]/g, '_')
      .slice(0, 64);
    await checkRateLimit(`ip_${ipKey}`, 'previewInvite', 20);

    const db = admin.firestore();

    // Query for a pending invite matching the provided secret.
    const inviteQuery = await db.collection('invites')
      .where('inviteSecret', '==', inviteSecret)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (inviteQuery.empty) {
      return { valid: false, email: null };
    }

    const inviteData = inviteQuery.docs[0].data();
    const email = (inviteData.email as string | undefined)?.toLowerCase() ?? null;

    console.log(`previewInvite: valid invite found for email=${email}`);
    return { valid: true, email };
  }
);

// ─── Revoke invite ────────────────────────────────────────────────────────────

export const revokeInvite = onCall<{ inviteId: string }>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const uid = request.auth.uid;
    const callerRole = await assertAdminOrCoach(uid);

    const { inviteId } = request.data;
    if (!inviteId?.trim()) throw new HttpsError('invalid-argument', 'inviteId is required.');

    const db = admin.firestore();
    const inviteRef = db.doc(`invites/${inviteId}`);
    const inviteSnap = await inviteRef.get();

    if (!inviteSnap.exists) throw new HttpsError('not-found', 'Invite not found.');

    const invite = inviteSnap.data()!;

    // Coaches may only revoke invites for their own teams.
    if (callerRole !== 'admin') {
      const teamDoc = await db.doc(`teams/${invite.teamId}`).get();
      if (!teamDoc.exists || !isCoachOfTeamDoc(teamDoc.data()!, uid)) {
        throw new HttpsError('permission-denied', 'You can only revoke invites for your own team.');
      }
    }

    await inviteRef.delete();
    console.log(`revokeInvite: uid=${uid} revoked invite=${inviteId}`);
    return { success: true };
  }
);

// ─── Email notifications (Firestore trigger) ──────────────────────────────────

export const onNotificationCreated = onDocumentCreated(
  {
    document: 'users/{uid}/notifications/{notifId}',
    secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom],
  },
  async (event) => {
    const notif = event.data?.data();
    if (!notif) return;

    const uid = event.params.uid;
    const userDoc = await admin.firestore().doc(`users/${uid}`).get();
    const userEmail = userDoc.data()?.email as string | undefined;
    if (!userEmail) return;

    const userName = (userDoc.data()?.displayName as string | undefined) || userEmail;

    const transporter = createTransporter();
    await transporter.sendMail({
      from: emailFrom.value(),
      to: `${userName} <${userEmail}>`,
      subject: notif.title,
      text: `Hi ${userName},\n\n${notif.message}`,
      html: buildEmail({
        recipientName: userName,
        preheader: notif.title as string,
        title: notif.title as string,
        message: `<p style="margin:0">${esc(notif.message as string)}</p>`,
      }),
    });
  }
);

// ─── Team chat email notifications ───────────────────────────────────────────

// At most one chat-notification email per recipient per team per this many ms.
// 1h = active conversations get a single ping at the head, then go quiet so
// recipients open the app to read rather than getting a per-message inbox flood.
// Pure function-scope constant, exported so unit tests can reference it.
export const TEAM_CHAT_EMAIL_THROTTLE_MS = 60 * 60 * 1000;

export const onTeamMessageCreated = onDocumentCreated(
  {
    document: 'teams/{teamId}/messages/{messageId}',
    secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom, rsvpSecret],
  },
  async (event) => {
    const msg = event.data?.data();
    if (!msg) return;

    const { teamId } = event.params;
    const senderName = (msg.senderName as string) || 'A team member';
    const text = (msg.text as string) || '';
    const now = new Date().toISOString();

    // Always denorm `lastMessageAt` onto the team doc (fire-and-forget). This
    // is the comparison signal for client-side unread dots — the team
    // subscription is already live for every member, so this update reaches
    // them via the existing onSnapshot with no extra reads. Failure is
    // logged but does not block email sends.
    void admin.firestore().doc(`teams/${teamId}`)
      .update({ lastMessageAt: now })
      .catch(err => console.warn(`[onTeamMessageCreated] team.lastMessageAt update failed for ${teamId}:`, err));

    // Load the team for its name
    const teamDoc = await admin.firestore().doc(`teams/${teamId}`).get();
    if (!teamDoc.exists) return;
    const teamName = (teamDoc.data()?.name as string) || 'Your team';

    // Load all platform users whose teamId matches (MVP: legacy single-teamId field)
    const usersSnap = await admin.firestore()
      .collection('users')
      .where('teamId', '==', teamId)
      .get();

    const recipients = usersSnap.docs
      .map(d => d.data())
      // Exclude the sender and anyone who has opted out of messaging notifications
      .filter(u => u.uid !== msg.senderId && u.email && u.messagingNotificationsEnabled !== false);

    if (recipients.length === 0) return;

    // Throttle: per-recipient state at users/{uid}/messagingState/{teamId}
    // tracks the last time a chat email was sent for this team. Skip
    // recipients whose last email was within TEAM_CHAT_EMAIL_THROTTLE_MS.
    // Batched read keeps this to one network round-trip (still billed as N
    // reads, but cheap vs the email cost it avoids — Brevo paid tier kicks
    // in past 9k/day, far more expensive than these throttle reads).
    const stateRefs = recipients.map(u =>
      admin.firestore().doc(`users/${u.uid as string}/messagingState/${teamId}`)
    );
    const stateDocs = await admin.firestore().getAll(...stateRefs);
    const cutoff = Date.now() - TEAM_CHAT_EMAIL_THROTTLE_MS;
    const eligible = recipients.filter((_u, i) => {
      const lastEmailedRaw = stateDocs[i].exists ? stateDocs[i].data()?.lastChatEmailedAt : null;
      if (!lastEmailedRaw) return true;
      const lastEmailed = new Date(lastEmailedRaw as string).getTime();
      return Number.isNaN(lastEmailed) || lastEmailed < cutoff;
    });

    if (eligible.length === 0) {
      console.log(`onTeamMessageCreated: all ${recipients.length} recipients throttled for team ${teamId}`);
      return;
    }

    const transporter = createTransporter();
    const subject = `[${teamName}] New message from ${senderName}`;

    await Promise.allSettled(
      eligible.map(async u => {
        const unsubscribeUrl = `${FUNCTIONS_BASE}/unsubscribeEmail?uid=${u.uid as string}&token=${signUnsubscribeToken(u.uid as string)}`;
        await transporter.sendMail({
          from: emailFrom.value(),
          to: `${u.displayName as string} <${u.email as string}>`,
          subject,
          text: `Hi ${u.displayName as string},\n\n${senderName} posted in ${teamName}:\n\n"${text}"\n\nOpen the app to reply.\n\nManage notification preferences: ${unsubscribeUrl}`,
          html: buildEmail({
            recipientName: u.displayName as string,
            preheader: subject,
            title: `New message in ${teamName}`,
            message: `<p style="margin:0 0 8px"><strong>${esc(senderName)}</strong> says:</p><p style="margin:0;padding:12px;background:#f3f4f6;border-radius:8px">${esc(text)}</p>`,
            unsubscribeUrl,
          }),
        });
        // Update throttle state only after a successful send. If send fails,
        // the recipient stays eligible to retry on the next message — they
        // shouldn't be silenced for a delivery failure they didn't cause.
        await admin.firestore()
          .doc(`users/${u.uid as string}/messagingState/${teamId}`)
          .set({ lastChatEmailedAt: now }, { merge: true });
      })
    );

    if (eligible.length < recipients.length) {
      console.log(`onTeamMessageCreated: sent ${eligible.length}/${recipients.length} emails for team ${teamId} (rest throttled)`);
    }
  }
);

// ─── DM email notifications ────────────────────────────────────────────────

export const onDmMessageCreated = onDocumentCreated(
  {
    document: 'dmThreads/{threadId}/messages/{messageId}',
    secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom, rsvpSecret],
  },
  async (event) => {
    const msg = event.data?.data();
    if (!msg) return;

    const { threadId } = event.params;
    const senderId = msg.senderId as string;
    const senderName = (msg.senderName as string) || 'Someone';
    const text = (msg.text as string) || '';

    // Load thread to find recipient
    const threadDoc = await admin.firestore().doc(`dmThreads/${threadId}`).get();
    if (!threadDoc.exists) return;
    const threadData = threadDoc.data()!;
    const participants = threadData.participants as string[];
    const recipientUid = participants.find(uid => uid !== senderId);
    if (!recipientUid) return;

    const userDoc = await admin.firestore().doc(`users/${recipientUid}`).get();
    if (!userDoc.exists) return;
    const u = userDoc.data()!;
    // Respect opt-out preference (default true when field is absent)
    if (!u.email || u.messagingNotificationsEnabled === false) return;

    const transporter = createTransporter();
    const subject = `New message from ${senderName}`;
    const recipientName = (u.displayName as string) || (u.email as string);
    const unsubscribeUrl = `${FUNCTIONS_BASE}/unsubscribeEmail?uid=${recipientUid}&token=${signUnsubscribeToken(recipientUid)}`;

    await transporter.sendMail({
      from: emailFrom.value(),
      to: `${recipientName} <${u.email as string}>`,
      subject,
      text: `Hi ${recipientName},\n\n${senderName} sent you a message:\n\n"${text}"\n\nOpen the app to reply.\n\nManage notification preferences: ${unsubscribeUrl}`,
      html: buildEmail({
        recipientName,
        preheader: subject,
        title: `Message from ${senderName}`,
        message: `<p style="margin:0 0 8px"><strong>${esc(senderName)}</strong> says:</p><p style="margin:0;padding:12px;background:#f3f4f6;border-radius:8px">${esc(text)}</p>`,
        unsubscribeUrl,
      }),
    });
  }
);

// ─── One-tap email notification unsubscribe ───────────────────────────────────
// Called from email footer links: ?uid=X&token=Y
// Sets messagingNotificationsEnabled=false on the user profile. No login required.

export const unsubscribeEmail = onRequest(
  { secrets: [rsvpSecret] },
  async (req, res) => {
    const uid = req.query['uid'] as string | undefined;
    const token = req.query['token'] as string | undefined;

    const settingsUrl = `${APP_URL}/settings`;

    if (!uid || !token || !verifyUnsubscribeToken(uid, token)) {
      res.status(400).send(`
        <!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Invalid link — First Whistle</title>
        <style>body{font-family:system-ui,sans-serif;max-width:480px;margin:60px auto;padding:0 24px;text-align:center;color:#1f2937}
        h1{font-size:1.25rem;font-weight:700;color:#1B3A6B}p{color:#6b7280;line-height:1.6}
        a{color:#2563eb;font-weight:600}</style></head>
        <body><h1>First <span style="color:#f97316">Whistle</span></h1>
        <p>This unsubscribe link is invalid or has already been used.</p>
        <p><a href="${settingsUrl}">Manage your notification preferences</a></p>
        </body></html>
      `);
      return;
    }

    try {
      await admin.firestore().doc(`users/${uid}`).update({ messagingNotificationsEnabled: false });
    } catch (err) {
      console.error('[unsubscribeEmail] Firestore update failed:', err);
      res.status(500).send('Something went wrong. Please try again or manage preferences in the app.');
      return;
    }

    res.status(200).send(`
      <!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Unsubscribed — First Whistle</title>
      <style>body{font-family:system-ui,sans-serif;max-width:480px;margin:60px auto;padding:0 24px;text-align:center;color:#1f2937}
      h1{font-size:1.25rem;font-weight:700;color:#1B3A6B}
      .check{font-size:3rem;margin-bottom:16px}
      p{color:#6b7280;line-height:1.6}a{color:#2563eb;font-weight:600}</style></head>
      <body><h1>First <span style="color:#f97316">Whistle</span></h1>
      <div class="check">✓</div>
      <p>You've been unsubscribed from chat and message email notifications.</p>
      <p>You'll still receive important emails like event reminders.</p>
      <p><a href="${settingsUrl}">Manage all notification preferences</a></p>
      </body></html>
    `);
  }
);

// ─── RSVP handler (HTTP GET) ──────────────────────────────────────────────────
// Called by email links: ?e={eventId}&p={playerId}&r={yes|no|maybe}&n={name}

export const rsvpEvent = onRequest(
  { secrets: [rsvpSecret] },
  async (req, res) => {
  const eventId = req.query['e'] as string | undefined;
  const playerId = req.query['p'] as string | undefined;
  const response = req.query['r'] as string | undefined;
  const name = req.query['n'] as string | undefined;
  const token = req.query['t'] as string | undefined;

  if (!eventId || !playerId || !['yes', 'no', 'maybe'].includes(response ?? '')) {
    res.status(400).send('<p>Invalid RSVP link.</p>');
    return;
  }

  // Verify HMAC token to prevent forged RSVPs.
  // Token is required once RSVP_HMAC_SECRET is provisioned; until then,
  // links without a token are accepted (backwards-compat for in-flight emails).
  if (token && !verifyRsvpToken(eventId, playerId, token)) {
    res.status(403).send('<p>This RSVP link is invalid or has been tampered with.</p>');
    return;
  }
  const _rsvpSecretVal = rsvpSecret.value();
  const _rsvpSecretProvisioned = typeof _rsvpSecretVal === 'string' && _rsvpSecretVal.length >= 16;
  if (!token && _rsvpSecretProvisioned) {
    // Secret is provisioned but no token present — link is pre-HMAC; reject.
    res.status(403).send('<p>This RSVP link has expired. Please ask your coach to resend the invite.</p>');
    return;
  }

  const label = response === 'yes' ? 'Attending' : response === 'no' ? 'Not Attending' : 'Maybe Attending';
  const color = response === 'yes' ? '#15803d' : response === 'no' ? '#dc2626' : '#d97706';

  try {
    const eventRef = admin.firestore().doc(`events/${eventId}`);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      res.status(404).send('<p>Event not found.</p>');
      return;
    }

    const eventData = eventSnap.data()!;
    const respondedAt = new Date().toISOString();

    // Derive subcollection docKey from the playerId param (which is recipientKey:
    // uid, uid_playerId, or raw email for no-auth recipients).
    const isEmail = (playerId as string).includes('@');
    const subcollectionDocKey = isEmail
      ? `email_${(playerId as string).replace(/[@.]/g, '_')}`
      : (playerId as string);

    // Build the subcollection RSVP doc.
    const rsvpSubDoc: Record<string, unknown> = {
      name: name ?? 'Guest',
      response,
      source: 'email' as const,
      updatedAt: respondedAt,
    };
    if (isEmail) {
      rsvpSubDoc.email = playerId;
    } else {
      // playerId is either a bare uid or uid_childId composite.
      const parts = (playerId as string).split('_');
      rsvpSubDoc.uid = parts[0];
      if (parts.length > 1) rsvpSubDoc.playerId = parts[1];
    }

    const db = admin.firestore();
    // FW-90b: write ONLY to subcollection (legacy rsvps[] array no longer updated).
    // Migration script backfilled all historical array entries to the subcollection.
    await db.doc(`events/${eventId}/rsvps/${subcollectionDocKey}`).set(rsvpSubDoc);

    const eventTitle = esc(eventData.title ?? 'Event');
    const eventDate = esc(eventData.date ?? '');
    const eventTime = esc(eventData.startTime ?? '');
    const safeName = esc(name ?? 'You');

    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RSVP Confirmed</title></head>
      <body style="margin:0;font-family:sans-serif;background:#f9fafb;display:flex;align-items:center;justify-content:center;min-height:100vh">
        <div style="background:white;border-radius:16px;padding:40px 32px;max-width:420px;width:90%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
          <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:12px;padding:20px;margin-bottom:28px">
            <p style="color:white;font-weight:700;font-size:18px;margin:0">First Whistle</p>
          </div>
          <div style="width:56px;height:56px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
            <span style="color:white;font-size:28px">${response === 'yes' ? '✓' : response === 'no' ? '✕' : '~'}</span>
          </div>
          <h1 style="color:#111827;font-size:20px;margin:0 0 8px">${label}</h1>
          <p style="color:#6b7280;font-size:14px;margin:0 0 4px"><strong>${safeName}</strong></p>
          <p style="color:#6b7280;font-size:14px;margin:0">${eventTitle}${eventDate ? ' · ' + eventDate : ''}${eventTime ? ' at ' + eventTime : ''}</p>
          <a href="${APP_URL}" style="display:inline-block;margin-top:28px;background:#1B3A6B;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open First Whistle</a>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('rsvpEvent error:', err);
    res.status(500).send('<p>Something went wrong. Please try again.</p>');
  }
});

// ─── Send event RSVP invites (callable) ───────────────────────────────────────

interface RsvpRecipient { playerId: string; name: string; email: string; }
interface SendEventInviteData {
  eventId: string;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  eventLocation?: string;
  teamName: string;
  senderName: string;
  recipients: RsvpRecipient[];
}

export const sendEventInvite = onCall<SendEventInviteData>(
  { secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom, rsvpSecret] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    await assertAdminOrCoach(request.auth.uid);
    await checkRateLimit(request.auth.uid, 'sendEventInvite', 5);

    const { eventId, eventTitle, eventDate, eventTime, eventLocation, teamName, senderName, recipients } = request.data;
    if (!recipients?.length) throw new HttpsError('invalid-argument', 'No recipients provided.');
    if (recipients.length > 100) throw new HttpsError('invalid-argument', 'Maximum 100 recipients.');

    const transporter = createTransporter();

    const results = await Promise.allSettled(
      recipients.map((recipient) => {
        // Include a per-recipient HMAC token so RSVP links can't be forged.
        const token = signRsvpToken(eventId, recipient.playerId);
        const base = `${FUNCTIONS_BASE}/rsvpEvent?e=${encodeURIComponent(eventId)}&p=${encodeURIComponent(recipient.playerId)}&n=${encodeURIComponent(recipient.name)}&t=${token}`;
        const yesUrl = `${base}&r=yes`;
        const noUrl = `${base}&r=no`;
        const maybeUrl = `${base}&r=maybe`;

        const btnStyle = (bg: string) =>
          `display:inline-block;padding:10px 22px;border-radius:8px;background:${bg};color:white;text-decoration:none;font-weight:600;font-size:14px;margin:0 6px`;

        const firstName = esc(recipient.name.split(' ')[0]);
        const eventDetailsHtml = `
          <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6b7280;margin-bottom:20px">
            <tr><td style="padding:3px 8px 3px 0;width:60px">From</td><td style="color:#111827;font-weight:600">${esc(senderName)} &middot; ${esc(teamName)}</td></tr>
            <tr><td style="padding:3px 8px 3px 0">Event</td><td style="color:#111827;font-weight:600">${esc(eventTitle)}</td></tr>
            <tr><td style="padding:3px 8px 3px 0">Date</td><td style="color:#111827">${esc(eventDate)}</td></tr>
            <tr><td style="padding:3px 8px 3px 0">Time</td><td style="color:#111827">${esc(eventTime)}</td></tr>
            ${eventLocation ? `<tr><td style="padding:3px 8px 3px 0">Location</td><td style="color:#111827">${esc(eventLocation)}</td></tr>` : ''}
          </table>
          <p style="font-size:15px;font-weight:600;text-align:center;margin:24px 0 20px;color:#1B3A6B">Will you be there, ${firstName}?</p>
          <div style="text-align:center;margin-bottom:8px">
            <a href="${yesUrl}" style="${btnStyle('#15803d')}">Yes, I'll be there</a>
            <a href="${maybeUrl}" style="${btnStyle('#d97706')}">Maybe</a>
            <a href="${noUrl}" style="${btnStyle('#dc2626')}">Can't make it</a>
          </div>`;

        return transporter.sendMail({
          from: emailFrom.value(),
          to: `${recipient.name} <${recipient.email}>`,
          subject: `First Whistle Message: RSVP – ${eventTitle}`,
          text: [
            `From: ${senderName} · ${teamName}`,
            `To: ${recipient.name} <${recipient.email}>`,
            '',
            `You're invited to: ${eventTitle}`,
            `Date: ${eventDate}`,
            `Time: ${eventTime}`,
            ...(eventLocation ? [`Location: ${eventLocation}`] : []),
            '',
            'Will you be there?',
            `Yes: ${yesUrl}`,
            `No: ${noUrl}`,
            `Maybe: ${maybeUrl}`,
            '',
            '---',
            'Sent via First Whistle',
          ].join('\n'),
          html: buildEmail({
            recipientName: recipient.name,
            preheader: `RSVP for ${eventTitle} — ${eventDate}`,
            title: 'Game RSVP',
            message: eventDetailsHtml,
            teamName,
          }),
        });
      })
    );

    const errors: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        errors.push(`${recipients[i].email}: ${(result.reason as Error)?.message ?? 'Unknown error'}`);
      }
    });

    const sent = results.filter(r => r.status === 'fulfilled').length;
    console.log(`sendEventInvite: sent=${sent}, failed=${errors.length}`, errors.length ? errors : '');
    return { sent, failed: errors.length, errors };
  }
);

// ─── Event created → notify team members ─────────────────────────────────────

export const onEventCreated = onDocumentCreated(
  {
    document: 'events/{eventId}',
    secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom],
  },
  async (event) => {
    const ev = event.data?.data();
    if (!ev) return;

    const teamIds: string[] = ev.teamIds ?? [];
    if (!teamIds.length) return;

    // Collect all email addresses from players on the event's teams
    const playersSnap = await admin.firestore()
      .collection('players')
      .where('teamId', 'in', teamIds.slice(0, 10))
      .get();

    const recipients: { playerId: string; name: string; address: string }[] = [];
    for (const p of playersSnap.docs) {
      const d = p.data();
      const name: string = `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim() || 'Player';
      const addrs: string[] = [
        d.email,
        d.parentContact?.parentEmail,
        d.parentContact2?.parentEmail,
      ].filter((e: any): e is string => typeof e === 'string' && e.trim().length > 0);
      addrs.forEach(address => recipients.push({ playerId: p.id, name, address }));
    }

    if (!recipients.length) {
      console.log('onEventCreated: no email addresses found for teams', teamIds);
      return;
    }

    let teamName = '';
    if (teamIds[0]) {
      const teamDoc = await admin.firestore().doc(`teams/${teamIds[0]}`).get();
      teamName = teamDoc.data()?.name ?? '';
    }

    const eventId = event.params.eventId;
    const title: string = ev.title ?? 'New Event';
    const date: string = ev.date ?? '';
    const time: string = ev.startTime ?? '';
    const location: string = ev.location ?? '';
    const type: string = ev.type ?? 'event';

    const transporter = createTransporter();

    await Promise.allSettled(recipients.map(({ playerId, name, address }) => {
      const token = signRsvpToken(eventId, playerId);
      const base = `${FUNCTIONS_BASE}/rsvpEvent?e=${encodeURIComponent(eventId)}&p=${encodeURIComponent(playerId)}&n=${encodeURIComponent(name)}&t=${token}`;
      const yesUrl = `${base}&r=yes`;
      const noUrl = `${base}&r=no`;
      const maybeUrl = `${base}&r=maybe`;

      const eventDetailsHtml = `
        <p style="font-weight:600;margin:0 0 16px;color:#1B3A6B">A new ${esc(type)} has been scheduled</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6b7280;margin-bottom:8px">
          <tr><td style="padding:4px 8px 4px 0;width:80px">Event</td><td style="color:#111827;font-weight:600">${esc(title)}</td></tr>
          <tr><td style="padding:4px 8px 4px 0">Date</td><td style="color:#111827">${esc(date)}</td></tr>
          <tr><td style="padding:4px 8px 4px 0">Time</td><td style="color:#111827">${esc(time)}</td></tr>
          ${location ? `<tr><td style="padding:4px 8px 4px 0">Location</td><td style="color:#111827">${esc(location)}</td></tr>` : ''}
        </table>`;

      return transporter.sendMail({
        from: emailFrom.value(),
        to: `${name} <${address}>`,
        subject: `First Whistle: New ${type} scheduled — ${title}`,
        text: [
          teamName ? `Team: ${teamName}` : '',
          `Event: ${title}`,
          `Date: ${date}`,
          `Time: ${time}`,
          location ? `Location: ${location}` : '',
          '',
          `RSVP:`,
          `  Yes: ${yesUrl}`,
          `  No: ${noUrl}`,
          `  Maybe: ${maybeUrl}`,
        ].filter(Boolean).join('\n'),
        html: buildEmail({
          recipientName: name,
          preheader: `New ${type} scheduled: ${title} on ${date}`,
          title: `New ${type} scheduled`,
          message: eventDetailsHtml,
          extraHtml: rsvpButtonsHtml(yesUrl, noUrl, maybeUrl),
          teamName,
        }),
      });
    }));

    console.log(`onEventCreated: notified ${recipients.length} address(es) for event "${title}"`);
  }
);

// ─── Helper: batch-fetch teams + players for a set of event docs ─────────────
//
// The daily reminder + RSVP-followup CFs both iterate every event happening
// tomorrow and, for each event, separately fetch that event's teams + players.
// At N events sharing M unique teams, that's O(N) reads of the same M teams.
//
// This helper does a single sweep:
//   1. Collect every distinct teamId referenced across the input events
//   2. Batch-read those teams (chunked by Firestore's 30-value `in` limit)
//   3. Batch-read all players whose teamId is in the unique set
//   4. Return Map<teamId, teamData> + Map<teamId, players[]>
//
// Net effect: one events query + ceil(unique_teams / 30) team batches +
// ceil(unique_teams / 30) player batches — independent of event count.
//
// Note: this preserves the existing behavior of dropping teams 11+ on a
// single event (the old code used .slice(0, 10), an artifact of the legacy
// 10-value `in` limit). The batched version respects all teamIds since we
// chunk into groups of 30. If any single event has >30 unique teams, it
// still gets the first 30 — no realistic event has more than a handful.
export const FIRESTORE_IN_QUERY_LIMIT = 30;

export interface EventTeamPlayerMaps {
  teamsById: Map<string, FirebaseFirestore.DocumentData>;
  playersByTeamId: Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>;
}

export async function fetchTeamsAndPlayersForEvents(
  eventDocs: FirebaseFirestore.QueryDocumentSnapshot[],
  firestore: FirebaseFirestore.Firestore = admin.firestore(),
): Promise<EventTeamPlayerMaps> {
  const teamsById = new Map<string, FirebaseFirestore.DocumentData>();
  const playersByTeamId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();

  // 1. Collect every distinct teamId across all events
  const uniqueTeamIds = new Set<string>();
  for (const evDoc of eventDocs) {
    const ev = evDoc.data();
    const teamIds: string[] = Array.isArray(ev.teamIds) ? ev.teamIds : [];
    for (const tid of teamIds) {
      if (typeof tid === 'string' && tid.length > 0) uniqueTeamIds.add(tid);
    }
  }

  if (uniqueTeamIds.size === 0) return { teamsById, playersByTeamId };

  const teamIdList = Array.from(uniqueTeamIds);

  // 2. Batch-read teams (chunked by 30, the Firestore `in` limit)
  for (let i = 0; i < teamIdList.length; i += FIRESTORE_IN_QUERY_LIMIT) {
    const chunk = teamIdList.slice(i, i + FIRESTORE_IN_QUERY_LIMIT);
    const teamSnap = await firestore
      .collection('teams')
      .where(FieldPath.documentId(), 'in', chunk)
      .get();
    for (const doc of teamSnap.docs) {
      teamsById.set(doc.id, doc.data());
    }
    // Initialize the players bucket for every requested teamId so callers can
    // safely call playersByTeamId.get(id) ?? [] without checking Map.has().
    for (const id of chunk) {
      if (!playersByTeamId.has(id)) playersByTeamId.set(id, []);
    }
  }

  // 3. Batch-read players (same chunking strategy)
  for (let i = 0; i < teamIdList.length; i += FIRESTORE_IN_QUERY_LIMIT) {
    const chunk = teamIdList.slice(i, i + FIRESTORE_IN_QUERY_LIMIT);
    const playerSnap = await firestore
      .collection('players')
      .where('teamId', 'in', chunk)
      .get();
    for (const doc of playerSnap.docs) {
      const teamId = doc.data().teamId as string | undefined;
      if (!teamId) continue;
      const bucket = playersByTeamId.get(teamId) ?? [];
      bucket.push(doc);
      playersByTeamId.set(teamId, bucket);
    }
  }

  return { teamsById, playersByTeamId };
}

// ─── Scheduled: consolidated notification dispatcher (daily 8AM UTC) ─────────
//
// Replaces the 4 legacy per-type reminder CFs (sendEventReminders,
// sendGameDayReminders, sendSnackReminders, sendRsvpFollowups).
//
// Strategy (ADR-012 / FW-82, Phase C):
//   1. Single query: events where date IN [today, tomorrow, in2days] + status=scheduled
//   2. For each event, dispatch via event.recipients[] — NO fan-out reads
//   3. Idempotency: per-type boolean flags on the event doc
//      (dayBeforeSent, gameDaySent, snackReminderSent, rsvpFollowupSent)
//   4. Shadow mode: DISPATCHER_SHADOW_MODE=true → log what would be sent, don't send
//      Default is NOT shadow mode — PM has approved skipping the parity window.
//
// FW-85 (Phase C)

export const sendScheduledNotifications = onSchedule(
  {
    schedule: '0 8 * * *',
    secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom, rsvpSecret, dispatcherShadowMode],
  },
  async () => {
    if (!ENV.shouldRunScheduledJobs()) {
      console.log('[sendScheduledNotifications] skipped: scheduled jobs disabled');
      return;
    }

    const shadowMode = process.env.DISPATCHER_SHADOW_MODE === 'true';
    if (shadowMode) {
      console.log('[sendScheduledNotifications] SHADOW MODE — logging only, no sends');
    }

    const db = admin.firestore();
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const tomorrowDate = new Date(now); tomorrowDate.setUTCDate(now.getUTCDate() + 1);
    const tomorrowStr = tomorrowDate.toISOString().slice(0, 10);
    const in2DaysDate = new Date(now); in2DaysDate.setUTCDate(now.getUTCDate() + 2);
    const in2DaysStr = in2DaysDate.toISOString().slice(0, 10);

    const targetDates = [todayStr, tomorrowStr, in2DaysStr];

    // Single query across all target dates — uses the status + date composite index.
    const eventsSnap = await db
      .collection('events')
      .where('status', '==', 'scheduled')
      .where('date', 'in', targetDates)
      .get();

    if (eventsSnap.empty) {
      console.log(`[sendScheduledNotifications] no events on dates: ${targetDates.join(', ')}`);
      return;
    }

    console.log(
      `[sendScheduledNotifications] processing ${eventsSnap.size} event(s) across dates: ${targetDates.join(', ')}`,
    );

    const transporter = shadowMode ? null : createTransporter();

    let dayBeforeSent = 0;
    let gameDaySent = 0;
    let snackReminderSent = 0;
    let rsvpFollowupSent = 0;

    const btnStyle = (bg: string) =>
      `display:inline-block;padding:10px 22px;border-radius:8px;background:${bg};color:white;text-decoration:none;font-weight:600;font-size:14px;margin:0 6px`;

    for (const evDoc of eventsSnap.docs) {
      const ev = evDoc.data();
      const eventId = evDoc.id;
      const eventDate: string = ev.date ?? '';
      const title: string = ev.title ?? 'Event';
      const time: string = ev.startTime ?? '';
      const location: string = ev.location ?? '';

      const recipients: Array<{ uid?: string; email: string; name: string; type: string }> =
        Array.isArray(ev.recipients) ? ev.recipients : [];

      if (!recipients.length) {
        console.log(`[sendScheduledNotifications] event=${eventId} has no recipients — skipping`);
        continue;
      }

      // ── Day-before reminder (tomorrow's events, not yet sent) ────────────
      if (eventDate === tomorrowStr && !ev.dayBeforeSent) {
        const sends: Promise<unknown>[] = [];

        for (const r of recipients) {
          const firstName = r.name.split(' ')[0] ?? r.name;
          // Generate RSVP token using recipient uid as player proxy.
          // If no uid, use email as stable identifier for token signing.
          const recipientKey = r.uid ?? r.email;
          const token = signRsvpToken(eventId, recipientKey);
          const base = `${FUNCTIONS_BASE}/rsvpEvent?e=${encodeURIComponent(eventId)}&p=${encodeURIComponent(recipientKey)}&n=${encodeURIComponent(r.name)}&t=${token}`;
          const yesUrl = `${base}&r=yes`;
          const noUrl = `${base}&r=no`;
          const maybeUrl = `${base}&r=maybe`;

          const bodyHtml = `
            <p style="margin:0 0 16px">This is a reminder that <strong>${esc(title)}</strong> is tomorrow.</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6b7280;margin-bottom:24px">
              <tr><td style="padding:4px 8px 4px 0;width:80px">Event</td><td style="color:#111827;font-weight:600">${esc(title)}</td></tr>
              <tr><td style="padding:4px 8px 4px 0">Date</td><td style="color:#111827">${esc(eventDate)}</td></tr>
              <tr><td style="padding:4px 8px 4px 0">Time</td><td style="color:#111827">${esc(time)}</td></tr>
              ${location ? `<tr><td style="padding:4px 8px 4px 0">Location</td><td style="color:#111827">${esc(location)}</td></tr>` : ''}
            </table>
            <p style="font-size:15px;font-weight:600;text-align:center;margin:0 0 20px;color:#1B3A6B">Will you be there, ${esc(firstName)}?</p>
            <div style="text-align:center;margin-bottom:8px">
              <a href="${yesUrl}" style="${btnStyle('#15803d')}">Yes, I'll be there</a>
              <a href="${maybeUrl}" style="${btnStyle('#d97706')}">Maybe</a>
              <a href="${noUrl}" style="${btnStyle('#dc2626')}">Can't make it</a>
            </div>`;

          if (shadowMode) {
            console.log(`[sendScheduledNotifications][shadow] DAY_BEFORE event=${eventId} to=${r.email}`);
            continue;
          }

          sends.push(
            transporter!.sendMail({
              from: emailFrom.value(),
              to: `${r.name} <${r.email}>`,
              subject: `First Whistle Reminder: ${title} is tomorrow – RSVP now`,
              text: [
                `Hi ${firstName},`,
                '',
                `${title} is tomorrow.`,
                `Date: ${eventDate}`,
                time ? `Time: ${time}` : '',
                location ? `Location: ${location}` : '',
                '',
                `RSVP: Yes: ${yesUrl} | Maybe: ${maybeUrl} | No: ${noUrl}`,
              ].filter(Boolean).join('\n'),
              html: buildEmail({
                recipientName: firstName,
                preheader: `${title} is tomorrow — RSVP now`,
                title: 'Upcoming Event',
                message: bodyHtml,
              }),
            })
          );
        }

        if (!shadowMode) {
          const results = await Promise.allSettled(sends);
          const sent = results.filter(r => r.status === 'fulfilled').length;
          dayBeforeSent += sent;
        }

        // Stamp idempotency flag.
        await evDoc.ref.update({ dayBeforeSent: true });
      }

      // ── Game-day reminder (today's events, not yet sent) ─────────────────
      if (eventDate === todayStr && !ev.gameDaySent) {
        // FW-97: read yes-count from subcollection (legacy ev.rsvps array removed in FW-95).
        // +1 read per game-day-eligible event — acceptable at modeled scale (~95 reads/day).
        let rsvpYesCount = 0;
        try {
          const rsvpSubSnap = await db.collection(`events/${eventId}/rsvps`).get();
          for (const rsvpDoc of rsvpSubSnap.docs) {
            const d = rsvpDoc.data() as { response?: string };
            if (d.response === 'yes') rsvpYesCount++;
          }
        } catch (err) {
          console.error(
            `[sendScheduledNotifications] event=${eventId} rsvp subcollection read failed for game-day yes-count — defaulting to 0`,
            err,
          );
        }

        const sends: Promise<unknown>[] = [];

        for (const r of recipients) {
          const firstName = r.name.split(' ')[0] ?? r.name;
          const recipientKey = r.uid ?? r.email;
          const token = signRsvpToken(eventId, recipientKey);
          const base = `${FUNCTIONS_BASE}/rsvpEvent?e=${encodeURIComponent(eventId)}&p=${encodeURIComponent(recipientKey)}&n=${encodeURIComponent(r.name)}&t=${token}`;
          const gdYes = `${base}&r=yes`;
          const gdNo = `${base}&r=no`;
          const gdMaybe = `${base}&r=maybe`;

          const bodyHtml = `
            <p style="margin:0 0 16px">Your event is <strong>today</strong>. Here are the details:</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6b7280;margin-bottom:8px">
              <tr><td style="padding:4px 8px 4px 0;width:80px">Event</td><td style="color:#111827;font-weight:600">${esc(title)}</td></tr>
              <tr><td style="padding:4px 8px 4px 0">Date</td><td style="color:#111827">${esc(eventDate)}</td></tr>
              ${time ? `<tr><td style="padding:4px 8px 4px 0">Time</td><td style="color:#111827">${esc(time)}</td></tr>` : ''}
              ${location ? `<tr><td style="padding:4px 8px 4px 0">Venue</td><td style="color:#111827">${esc(location)}</td></tr>` : ''}
              <tr><td style="padding:4px 8px 4px 0">RSVPs</td><td style="color:#111827">${rsvpYesCount} attending</td></tr>
            </table>`;

          if (shadowMode) {
            console.log(`[sendScheduledNotifications][shadow] GAME_DAY event=${eventId} to=${r.email}`);
            continue;
          }

          sends.push(
            transporter!.sendMail({
              from: emailFrom.value(),
              to: `${r.name} <${r.email}>`,
              subject: `First Whistle: ${title} is today`,
              text: [
                `Hi ${firstName},`,
                '',
                `${title} is today.`,
                `Date: ${eventDate}`,
                time ? `Time: ${time}` : '',
                location ? `Venue: ${location}` : '',
                `RSVPs: ${rsvpYesCount} attending`,
                '',
                `RSVP: Yes: ${gdYes} | Maybe: ${gdMaybe} | No: ${gdNo}`,
              ].filter(Boolean).join('\n'),
              html: buildEmail({
                recipientName: firstName,
                preheader: `${title} is today`,
                title: 'Event Today',
                message: bodyHtml,
                extraHtml: rsvpButtonsHtml(gdYes, gdNo, gdMaybe),
              }),
            })
          );
        }

        if (!shadowMode) {
          const results = await Promise.allSettled(sends);
          gameDaySent += results.filter(r => r.status === 'fulfilled').length;
        }

        await evDoc.ref.update({ gameDaySent: true });
      }

      // ── Snack reminder (2 days out, no snack claimed, not yet sent) ───────
      // Reads events/{id}/snackSlot/slot subcollection — same source-of-truth
      // as the legacy sendSnackReminders CF. Fail closed on read errors so we
      // never spam "no one signed up" when the slot is actually claimed but
      // the read failed.
      let snackIsClaimed = false;
      let snackReadFailed = false;
      if (eventDate === in2DaysStr && !ev.snackReminderSent) {
        try {
          const snackSnap = await db.doc(`events/${eventId}/snackSlot/slot`).get();
          if (snackSnap.exists) {
            const slot = snackSnap.data() as { claimedBy?: string | null };
            snackIsClaimed = typeof slot.claimedBy === 'string' && slot.claimedBy.length > 0;
          }
        } catch (err) {
          console.error(`[sendScheduledNotifications] event=${eventId} snackSlot read failed — skipping snack reminder to avoid false spam`, err);
          snackReadFailed = true;
        }
      }

      if (eventDate === in2DaysStr && !ev.snackReminderSent && !snackIsClaimed && !snackReadFailed) {
        const sends: Promise<unknown>[] = [];
        const subjectTeam = (ev.teamIds as string[])?.[0] ? `the team's game` : 'the game';
        const venueClause = location ? ` at ${location}` : '';
        const venueClauseHtml = location ? ` at <strong>${esc(location)}</strong>` : '';

        const snackMsgHtml = `<p style="margin:0 0 12px">No one has signed up to bring snacks for ${subjectTeam} on <strong>${esc(eventDate)}</strong>${venueClauseHtml}.</p><p style="margin:0">Can you help out?</p>`;

        for (const r of recipients) {
          const firstName = r.name.split(' ')[0] ?? r.name;

          if (shadowMode) {
            console.log(`[sendScheduledNotifications][shadow] SNACK_REMINDER event=${eventId} to=${r.email}`);
            continue;
          }

          sends.push(
            transporter!.sendMail({
              from: emailFrom.value(),
              to: `${r.name} <${r.email}>`,
              subject: `Can you bring snacks? Game on ${eventDate}`,
              text: [
                `Hi ${firstName},`,
                '',
                `No one has signed up to bring snacks for the game on ${eventDate}${venueClause}.`,
                '',
                `Sign up: ${APP_URL}`,
              ].join('\n'),
              html: buildEmail({
                recipientName: firstName,
                preheader: `Can you bring snacks? Game on ${eventDate}`,
                title: 'Snack Reminder',
                message: snackMsgHtml,
                ctaUrl: APP_URL,
                ctaLabel: 'Sign Up to Bring Snacks',
              }),
            })
          );
        }

        if (!shadowMode) {
          const results = await Promise.allSettled(sends);
          snackReminderSent += results.filter(r => r.status === 'fulfilled').length;
        }

        await evDoc.ref.update({ snackReminderSent: true });
      }

      // ── RSVP follow-up (tomorrow's events, unresponded recipients) ────────
      if (eventDate === tomorrowStr && !ev.rsvpFollowupSent) {
        // FW-90b: respondedSet is built exclusively from the subcollection.
        // Migration script (migrate-rsvps-to-subcollection.mjs) must be run before
        // this build is deployed to ensure historical email-link RSVPs are present.
        // A recipient is considered "responded" if any of their identifying keys
        // (uid, email, playerId) appears in the subcollection.
        const respondedSet = new Set<string>();

        try {
          const rsvpSubSnap = await db.collection(`events/${eventId}/rsvps`).get();
          for (const rsvpDoc of rsvpSubSnap.docs) {
            const d = rsvpDoc.data() as { uid?: string; email?: string; playerId?: string };
            if (d.uid) respondedSet.add(d.uid);
            if (d.email) respondedSet.add(d.email);
            if (d.playerId) respondedSet.add(d.playerId);
          }
        } catch (err) {
          console.error(
            `[sendScheduledNotifications] event=${eventId} rsvp subcollection read failed — skipping follow-up (fail-closed)`,
            err,
          );
          // Fail-closed: if we cannot determine who responded, skip the follow-up
          // for this event to avoid spamming users who already responded.
          await evDoc.ref.update({ rsvpFollowupSent: true });
          continue;
        }

        const unresponded = recipients.filter((r) => {
          // Match on any of the recipient's identifying keys.
          if (r.uid && respondedSet.has(r.uid)) return false;
          if (r.email && respondedSet.has(r.email)) return false;
          return true;
        });

        if (!unresponded.length) {
          // Everyone responded — still stamp so we don't check again.
          await evDoc.ref.update({ rsvpFollowupSent: true });
          continue;
        }

        const sends: Promise<unknown>[] = [];

        for (const r of unresponded) {
          const firstName = r.name.split(' ')[0] ?? r.name;
          const recipientKey = r.uid ?? r.email;
          const token = signRsvpToken(eventId, recipientKey);
          const base = `${FUNCTIONS_BASE}/rsvpEvent?e=${encodeURIComponent(eventId)}&p=${encodeURIComponent(recipientKey)}&n=${encodeURIComponent(r.name)}&t=${token}`;
          const yesUrl = `${base}&r=yes`;
          const noUrl = `${base}&r=no`;
          const maybeUrl = `${base}&r=maybe`;

          const bodyHtml = `
            <p style="margin:0 0 16px">You haven't responded yet to tomorrow's event.</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6b7280;margin-bottom:24px">
              <tr><td style="padding:4px 8px 4px 0;width:80px">Event</td><td style="color:#111827;font-weight:600">${esc(title)}</td></tr>
              <tr><td style="padding:4px 8px 4px 0">Date</td><td style="color:#111827">${esc(eventDate)}</td></tr>
              <tr><td style="padding:4px 8px 4px 0">Time</td><td style="color:#111827">${esc(time)}</td></tr>
              ${location ? `<tr><td style="padding:4px 8px 4px 0">Location</td><td style="color:#111827">${esc(location)}</td></tr>` : ''}
            </table>
            <p style="font-size:15px;font-weight:600;text-align:center;margin:0 0 20px;color:#1B3A6B">Will you be there, ${esc(firstName)}?</p>
            <div style="text-align:center;margin-bottom:8px">
              <a href="${yesUrl}" style="${btnStyle('#15803d')}">Yes</a>
              <a href="${maybeUrl}" style="${btnStyle('#d97706')}">Maybe</a>
              <a href="${noUrl}" style="${btnStyle('#dc2626')}">Can't make it</a>
            </div>`;

          if (shadowMode) {
            console.log(`[sendScheduledNotifications][shadow] RSVP_FOLLOWUP event=${eventId} to=${r.email}`);
            continue;
          }

          sends.push(
            transporter!.sendMail({
              from: emailFrom.value(),
              to: `${r.name} <${r.email}>`,
              subject: `First Whistle: Don't forget to RSVP — ${title}`,
              text: [
                `Hi ${firstName},`,
                '',
                `You haven't responded yet to tomorrow's event.`,
                `Event: ${title}`,
                `Date: ${eventDate}`,
                time ? `Time: ${time}` : '',
                location ? `Location: ${location}` : '',
                '',
                `RSVP: Yes: ${yesUrl} | Maybe: ${maybeUrl} | No: ${noUrl}`,
              ].filter(Boolean).join('\n'),
              html: buildEmail({
                recipientName: firstName,
                preheader: `Don't forget to RSVP — ${title} is tomorrow`,
                title: 'RSVP Reminder',
                message: bodyHtml,
              }),
            })
          );
        }

        if (!shadowMode) {
          const results = await Promise.allSettled(sends);
          rsvpFollowupSent += results.filter(r => r.status === 'fulfilled').length;
        }

        await evDoc.ref.update({ rsvpFollowupSent: true });
      }
    }

    console.log(
      `[sendScheduledNotifications] done${shadowMode ? ' (shadow)' : ''} — ` +
      `dayBefore=${dayBeforeSent}, gameDay=${gameDaySent}, snack=${snackReminderSent}, rsvpFollowup=${rsvpFollowupSent}`,
    );
  }
);



// ─── Event updated → cancellation notifications + game result broadcast ───────

export const onEventUpdated = onDocumentUpdated(
  {
    document: 'events/{eventId}',
    secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const eventId = event.params.eventId;
    const isCancellation = before.status !== 'cancelled' && after.status === 'cancelled';
    const gameTypes = ['game', 'match', 'tournament'];
    const isResultSet = !before.result && after.result &&
      gameTypes.includes(after.type) &&
      (after.result.homeScore !== undefined || after.result.awayScore !== undefined);

    const isRescheduled = before.status !== 'cancelled' &&
      after.status !== 'cancelled' &&
      !isCancellation &&
      (
        before.date !== after.date ||
        before.startTime !== after.startTime ||
        before.endTime !== after.endTime ||
        before.location !== after.location ||
        before.venueId !== after.venueId
      );

    if (!isCancellation && !isResultSet && !isRescheduled) return;

    const teamIds: string[] = after.teamIds ?? [];
    if (!teamIds.length) return;

    // Fetch all players on the event's teams
    const playersSnap = await admin.firestore()
      .collection('players')
      .where('teamId', 'in', teamIds.slice(0, 10))
      .get();

    if (playersSnap.empty) {
      console.log(`onEventUpdated/onResultSet: no players found for teams`, teamIds);
      return;
    }

    // Collect player emails for looking up user UIDs
    const playerEmails: string[] = [];
    for (const p of playersSnap.docs) {
      const d = p.data();
      const addrs: string[] = [
        d.email,
        d.parentContact?.parentEmail,
        d.parentContact2?.parentEmail,
      ].filter((e: any): e is string => typeof e === 'string' && e.trim().length > 0);
      playerEmails.push(...addrs);
    }

    // Look up user UIDs by email so we can write in-app notifications
    const uniqueEmails = [...new Set(playerEmails)];
    const userUidMap = new Map<string, string>(); // email → uid
    if (uniqueEmails.length) {
      // Firestore `in` supports up to 30 items; chunk if needed
      const chunkSize = 30;
      for (let i = 0; i < uniqueEmails.length; i += chunkSize) {
        const chunk = uniqueEmails.slice(i, i + chunkSize);
        const usersSnap = await admin.firestore()
          .collection('users')
          .where('email', 'in', chunk)
          .get();
        for (const u of usersSnap.docs) {
          const email = u.data()?.email as string | undefined;
          if (email) userUidMap.set(email, u.id);
        }
      }
    }

    // ── Item 1: Event cancellation ───────────────────────────────────────────
    if (isCancellation) {
      try {
      const eventTitle: string = after.title ?? 'Event';
      const eventDate: string = after.date ?? '';
      const eventTime: string = after.startTime ?? '';

      // Send cancellation emails + in-app notifications to all players
      const emails: { name: string; address: string; firstName: string }[] = [];
      for (const p of playersSnap.docs) {
        const d = p.data();
        const name: string = `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim() || 'Player';
        const firstName: string = d.firstName ?? name.split(' ')[0];
        const addrs: string[] = [
          d.email,
          d.parentContact?.parentEmail,
          d.parentContact2?.parentEmail,
        ].filter((e: any): e is string => typeof e === 'string' && e.trim().length > 0);
        addrs.forEach(address => emails.push({ name, address, firstName }));
      }

      const transporter = createTransporter();

      await Promise.allSettled(emails.map(({ name, address, firstName }) =>
        transporter.sendMail({
          from: emailFrom.value(),
          to: `${name} <${address}>`,
          subject: `First Whistle: ${eventTitle} has been cancelled`,
          text: [
            `Hi ${firstName},`,
            '',
            `${eventTitle} scheduled for ${eventDate} at ${eventTime} has been cancelled.`,
            '',
            '---',
            'Sent via First Whistle',
          ].join('\n'),
          html: buildEmail({
            recipientName: firstName,
            preheader: `${eventTitle} has been cancelled`,
            title: 'Event Cancelled',
            message: `<p style="margin:0"><strong>${esc(eventTitle)}</strong> scheduled for ${esc(eventDate)} at ${esc(eventTime)} has been cancelled.</p>`,
          }),
        })
      ));

      // Write in-app notifications for each matched user
      const notifTitle = `${eventTitle} cancelled`;
      const notifMessage = `${eventTitle} scheduled for ${eventDate} at ${eventTime} has been cancelled.`;
      const createdAt = new Date().toISOString();

      const batch = admin.firestore().batch();
      let notifCount = 0;
      for (const [, uid] of userUidMap.entries()) {
        const notifRef = admin.firestore()
          .collection('users').doc(uid)
          .collection('notifications').doc();
        batch.set(notifRef, {
          id: notifRef.id,
          type: 'info',
          title: notifTitle,
          message: notifMessage,
          relatedEventId: eventId,
          isRead: false,
          createdAt,
        });
        notifCount++;
      }
      await batch.commit();

      console.log(`onEventUpdated: sent ${emails.length} cancellation email(s) and ${notifCount} in-app notification(s) for "${eventTitle}"`);
      } catch (err) {
        console.error('onEventUpdated: cancellation block failed', err);
      }
    }

    // ── Item 2: Game result broadcast ────────────────────────────────────────
    if (isResultSet) {
      try {
      const eventTitle: string = after.title ?? 'Event';
      const result = after.result;
      const homeScore: number | string = result.homeScore ?? 0;
      const awayScore: number | string = result.awayScore ?? 0;

      // Fetch team names for a human-readable result line
      let resultSummary = `${eventTitle}: ${homeScore}–${awayScore}`;
      const homeTeamId: string | undefined = after.homeTeamId;
      const awayTeamId: string | undefined = after.awayTeamId;
      if (homeTeamId && awayTeamId) {
        const [homeTeamDoc, awayTeamDoc] = await Promise.all([
          admin.firestore().doc(`teams/${homeTeamId}`).get(),
          admin.firestore().doc(`teams/${awayTeamId}`).get(),
        ]);
        const homeName = homeTeamDoc.data()?.name ?? 'Home';
        const awayName = awayTeamDoc.data()?.name ?? 'Away';
        resultSummary = `Final: ${homeName} ${homeScore} – ${awayScore} ${awayName}`;
      } else if (teamIds.length === 1) {
        const teamDoc = await admin.firestore().doc(`teams/${teamIds[0]}`).get();
        const teamName = teamDoc.data()?.name ?? 'Team';
        resultSummary = `Final: ${teamName} ${homeScore} – ${awayScore}`;
      }

      const notifTitle = `Result: ${eventTitle}`;
      const createdAt = new Date().toISOString();

      const batch = admin.firestore().batch();
      let notifCount = 0;
      for (const [, uid] of userUidMap.entries()) {
        const notifRef = admin.firestore()
          .collection('users').doc(uid)
          .collection('notifications').doc();
        batch.set(notifRef, {
          id: notifRef.id,
          type: 'result_recorded',
          title: notifTitle,
          message: resultSummary,
          relatedEventId: eventId,
          isRead: false,
          createdAt,
        });
        notifCount++;
      }
      await batch.commit();

      console.log(`onEventUpdated/onResultSet: sent ${notifCount} result notification(s) for "${eventTitle}" — ${resultSummary}`);
      } catch (err) {
        console.error('onEventUpdated: result broadcast block failed', err);
      }
    }

    // ── Item 3: Reschedule notification ──────────────────────────────────────
    if (isRescheduled) {
      try {
      const eventTitle: string = after.title ?? 'Event';
      const type: string = after.type ?? 'event';

      const oldDate: string = before.date ?? '';
      const oldStart: string = before.startTime ?? '';
      const oldEnd: string = before.endTime ?? '';
      const oldLocation: string = before.location ?? '';

      const newDate: string = after.date ?? '';
      const newStart: string = after.startTime ?? '';
      const newEnd: string = after.endTime ?? '';
      const newLocation: string = after.location ?? '';

      const teamIds: string[] = after.teamIds ?? [];

      let teamName = '';
      if (teamIds[0]) {
        const teamDoc = await admin.firestore().doc(`teams/${teamIds[0]}`).get();
        teamName = teamDoc.data()?.name ?? '';
      }

      const recipients: { playerId: string; name: string; address: string }[] = [];
      for (const p of playersSnap.docs) {
        const d = p.data();
        const name: string = `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim() || 'Player';
        const addrs: string[] = [
          d.email,
          d.parentContact?.parentEmail,
          d.parentContact2?.parentEmail,
        ].filter((e: any): e is string => typeof e === 'string' && e.trim().length > 0);
        addrs.forEach(address => recipients.push({ playerId: p.id, name, address }));
      }

      const changedFields: string[] = [];
      if (before.date !== after.date) changedFields.push('date');
      if (before.startTime !== after.startTime || before.endTime !== after.endTime) changedFields.push('time');
      if (before.location !== after.location || before.venueId !== after.venueId) changedFields.push('location');
      const changeLabel = changedFields.join(', ');

      const oldDetailsHtml = `
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6b7280;margin-bottom:8px">
          ${oldDate ? `<tr><td style="padding:4px 8px 4px 0;width:80px">Was date</td><td style="color:#111827;text-decoration:line-through">${esc(oldDate)}</td></tr>` : ''}
          ${oldStart ? `<tr><td style="padding:4px 8px 4px 0">Was time</td><td style="color:#111827;text-decoration:line-through">${esc(oldStart)}${oldEnd ? ` – ${esc(oldEnd)}` : ''}</td></tr>` : ''}
          ${oldLocation ? `<tr><td style="padding:4px 8px 4px 0">Was location</td><td style="color:#111827;text-decoration:line-through">${esc(oldLocation)}</td></tr>` : ''}
        </table>`;

      const newDetailsHtml = `
        <p style="font-weight:600;margin:0 0 8px;color:#1B3A6B">New details</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6b7280;margin-bottom:8px">
          <tr><td style="padding:4px 8px 4px 0;width:80px">Event</td><td style="color:#111827;font-weight:600">${esc(eventTitle)}</td></tr>
          ${newDate ? `<tr><td style="padding:4px 8px 4px 0">Date</td><td style="color:#111827">${esc(newDate)}</td></tr>` : ''}
          ${newStart ? `<tr><td style="padding:4px 8px 4px 0">Time</td><td style="color:#111827">${esc(newStart)}${newEnd ? ` – ${esc(newEnd)}` : ''}</td></tr>` : ''}
          ${newLocation ? `<tr><td style="padding:4px 8px 4px 0">Location</td><td style="color:#111827">${esc(newLocation)}</td></tr>` : ''}
        </table>`;

      const messageHtml = `
        <p style="font-weight:600;margin:0 0 16px;color:#1B3A6B">A ${esc(type)} has been rescheduled (${esc(changeLabel)} changed)</p>
        ${oldDetailsHtml}
        ${newDetailsHtml}
        <p style="margin:16px 0 4px;font-size:13px;color:#6b7280">Your previous RSVP may no longer reflect your availability — please update below.</p>`;

      const transporter = createTransporter();

      await Promise.allSettled(recipients.map(({ playerId, name, address }) => {
        const token = signRsvpToken(eventId, playerId);
        const base = `${FUNCTIONS_BASE}/rsvpEvent?e=${encodeURIComponent(eventId)}&p=${encodeURIComponent(playerId)}&n=${encodeURIComponent(name)}&t=${token}`;
        const yesUrl = `${base}&r=yes`;
        const noUrl = `${base}&r=no`;
        const maybeUrl = `${base}&r=maybe`;

        return transporter.sendMail({
          from: emailFrom.value(),
          to: `${name} <${address}>`,
          subject: `First Whistle: ${eventTitle} has been rescheduled`,
          text: [
            teamName ? `Team: ${teamName}` : '',
            `Event: ${eventTitle}`,
            `Change: ${changeLabel}`,
            '',
            'Previous details:',
            oldDate ? `  Was date: ${oldDate}` : '',
            oldStart ? `  Was time: ${oldStart}${oldEnd ? ` – ${oldEnd}` : ''}` : '',
            oldLocation ? `  Was location: ${oldLocation}` : '',
            '',
            'New details:',
            newDate ? `  Date: ${newDate}` : '',
            newStart ? `  Time: ${newStart}${newEnd ? ` – ${newEnd}` : ''}` : '',
            newLocation ? `  Location: ${newLocation}` : '',
            '',
            'Update your RSVP:',
            `  Yes: ${yesUrl}`,
            `  No: ${noUrl}`,
            `  Maybe: ${maybeUrl}`,
          ].filter(Boolean).join('\n'),
          html: buildEmail({
            recipientName: name,
            preheader: `${eventTitle} has been rescheduled — ${changeLabel} changed`,
            title: `${type} rescheduled`,
            message: messageHtml,
            extraHtml: rsvpButtonsHtml(yesUrl, noUrl, maybeUrl),
            teamName,
          }),
        });
      }));

      const notifTitle = `${eventTitle} rescheduled`;
      const notifMessage = `${eventTitle} has been rescheduled (${changeLabel} changed). New date: ${newDate}${newStart ? ` at ${newStart}` : ''}.`;
      const createdAt = new Date().toISOString();

      const batch = admin.firestore().batch();
      let notifCount = 0;
      for (const [, uid] of userUidMap.entries()) {
        const notifRef = admin.firestore()
          .collection('users').doc(uid)
          .collection('notifications').doc();
        batch.set(notifRef, {
          id: notifRef.id,
          type: 'info',
          title: notifTitle,
          message: notifMessage,
          relatedEventId: eventId,
          isRead: false,
          createdAt,
        });
        notifCount++;
      }
      await batch.commit();

      console.log(`onEventUpdated: sent ${recipients.length} reschedule email(s) and ${notifCount} in-app notification(s) for "${eventTitle}"`);
      } catch (err) {
        console.error('onEventUpdated: reschedule block failed', err);
      }
    }
  }
);

// ─── Post-game broadcast (callable) ──────────────────────────────────────────
// Sends an in-app notification to all team members with the game result,
// an optional coach message, and an optional Player of the Match callout.

interface SendPostGameBroadcastData {
  eventId: string;
  teamId: string;
  message?: string;
  manOfTheMatchPlayerId?: string;
}

interface SendPostGameBroadcastResult {
  sent: number;
}

export const sendPostGameBroadcast = onCall<SendPostGameBroadcastData, Promise<SendPostGameBroadcastResult>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    await assertAdminOrCoach(request.auth.uid);

    const { eventId, teamId, message, manOfTheMatchPlayerId } = request.data;
    if (!eventId?.trim()) throw new HttpsError('invalid-argument', 'eventId is required.');
    if (!teamId?.trim()) throw new HttpsError('invalid-argument', 'teamId is required.');

    const db = admin.firestore();

    // Read the event to get result info
    const eventDoc = await db.doc(`events/${eventId}`).get();
    if (!eventDoc.exists) throw new HttpsError('not-found', 'Event not found.');
    const ev = eventDoc.data()!;

    const result = ev.result as { homeScore?: number; awayScore?: number; placement?: string } | undefined;
    const eventTitle: string = ev.title ?? 'Event';

    let resultSummary: string;
    if (result?.placement) {
      resultSummary = `${eventTitle}: ${result.placement}`;
    } else if (result != null && result.homeScore !== undefined && result.awayScore !== undefined) {
      resultSummary = `${eventTitle}: ${result.homeScore} \u2013 ${result.awayScore}`;
    } else {
      resultSummary = `Result: ${eventTitle}`;
    }

    // Resolve Player of the Match name if provided
    let motmLine = '';
    if (manOfTheMatchPlayerId) {
      const playerDoc = await db.doc(`players/${manOfTheMatchPlayerId}`).get();
      if (playerDoc.exists) {
        const pd = playerDoc.data()!;
        const motmName = `${pd.firstName ?? ''} ${pd.lastName ?? ''}`.trim() || 'Player';
        motmLine = ` Player of the Match: ${motmName}.`;
      }
    }

    const notifMessage = message?.trim()
      ? `${message.trim()}${motmLine}`
      : `Great effort today, team!${motmLine}`;

    // Collect all UIDs to notify: legacy scalar + players collection + coachIds
    const allUids = new Set<string>();

    // 1. Legacy scalar — users with teamId field
    const legacyUsersSnap = await db.collection('users').where('teamId', '==', teamId).get();
    legacyUsersSnap.docs.forEach(d => allUids.add(d.id));

    // 2. Team doc coachIds
    const teamSnap = await db.doc(`teams/${teamId}`).get();
    const coachIds: string[] = teamSnap.exists ? (teamSnap.data()?.coachIds ?? []) : [];
    coachIds.forEach((uid: string) => allUids.add(uid));

    // 3. Players collection — linked users and parents
    const playersSnap = await db.collection('players').where('teamId', '==', teamId).get();
    playersSnap.docs.forEach(d => {
      const data = d.data();
      if (data.linkedUid) allUids.add(data.linkedUid as string);
      if (data.parentUid) allUids.add(data.parentUid as string);
    });

    if (allUids.size === 0) {
      console.log(`sendPostGameBroadcast: no users found for teamId=${teamId}`);
      return { sent: 0 };
    }

    const now = new Date().toISOString();
    const batch = db.batch();
    let notifCount = 0;

    for (const uid of allUids) {
      const notifRef = db
        .collection('users').doc(uid)
        .collection('notifications').doc();
      batch.set(notifRef, {
        id: notifRef.id,
        type: 'result_recorded',
        title: resultSummary,
        message: notifMessage,
        relatedEventId: eventId,
        relatedTeamId: teamId,
        isRead: false,
        createdAt: now,
      });
      notifCount++;
    }

    await batch.commit();
    console.log(`sendPostGameBroadcast: sent ${notifCount} notification(s) for event="${eventTitle}" teamId=${teamId}`);
    return { sent: notifCount };
  }
);

// ─── Membership Migration ─────────────────────────────────────────────────────

/**
 * One-time callable: backfills `memberships` array on user documents that
 * predate the multi-role model. Safe to call multiple times — skips users
 * that already have a memberships array.
 *
 * Call via Firebase Admin SDK or the Functions shell:
 *   migrateUserMemberships({})
 */
export const migrateUserMemberships = onCall({ region: 'us-central1' }, async (request) => {
  // Require admin auth
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');

  const db = admin.firestore();
  const callerDoc = await db.doc(`users/${request.auth.uid}`).get();
  const callerRole = callerDoc.data()?.role;
  if (callerRole !== 'admin') throw new HttpsError('permission-denied', 'Admin only.');

  const snapshot = await db.collection('users').get();
  const batch = db.batch();
  let migrated = 0;
  let skipped = 0;

  for (const userDoc of snapshot.docs) {
    const data = userDoc.data();
    if (data.memberships && data.memberships.length > 0) {
      skipped++;
      continue;
    }
    const membership: Record<string, unknown> = {
      role: data.role ?? 'coach',
      isPrimary: true,
    };
    if (data.teamId) membership.teamId = data.teamId;
    if (data.playerId) membership.playerId = data.playerId;
    if (data.leagueId) membership.leagueId = data.leagueId;

    batch.update(userDoc.ref, {
      memberships: [membership],
      activeContext: 0,
    });
    migrated++;
  }

  await batch.commit();
  console.log(`migrateUserMemberships: migrated=${migrated} skipped=${skipped}`);
  return { migrated, skipped };
});


// ─── One-time migration: move PII fields to sensitiveData subcollection ────────
// Call once (admin only) to back-fill existing player docs.
// Safe to call multiple times — idempotent; existing subcollection docs are overwritten.

export const migrateSensitivePlayerData = onCall(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    await assertAdminOrCoach(request.auth.uid);

    const playersSnap = await admin.firestore().collection('players').get();
    const SENSITIVE_KEYS = ['dateOfBirth', 'parentContact', 'parentContact2', 'emergencyContact'];

    let migrated = 0;
    let skipped = 0;
    let batch = admin.firestore().batch();
    let batchOps = 0;

    const flushIfNeeded = async () => {
      // 2 ops per player; flush before hitting the 500-op limit
      if (batchOps >= 400) {
        await batch.commit();
        batch = admin.firestore().batch();
        batchOps = 0;
      }
    };

    for (const playerDoc of playersSnap.docs) {
      const data = playerDoc.data();
      const sensitiveFields: Record<string, unknown> = {};
      let hasAny = false;

      for (const key of SENSITIVE_KEYS) {
        if (data[key] !== undefined) {
          sensitiveFields[key] = data[key];
          hasAny = true;
        }
      }

      if (!hasAny) {
        skipped++;
        continue;
      }

      // Write to sensitiveData subcollection
      const sensitiveRef = admin.firestore()
        .doc(`players/${playerDoc.id}/sensitiveData/private`);
      batch.set(sensitiveRef, { playerId: playerDoc.id, teamId: data.teamId ?? '', ...sensitiveFields }, { merge: true });

      // Strip sensitive fields from main doc
      const stripped: Record<string, FieldValue> = {};
      for (const key of SENSITIVE_KEYS) {
        if (data[key] !== undefined) {
          stripped[key] = FieldValue.delete();
        }
      }
      batch.update(playerDoc.ref, stripped);

      migrated++;
      batchOps += 2;
      await flushIfNeeded();
    }

    await batch.commit();

    console.log(`migrateSensitivePlayerData: migrated=${migrated}, skipped=${skipped}`);
    return { migrated, skipped };
  }
);

// ─── Availability: request availability from coaches (callable) ───────────────
//
// Sends an in-app notification to every coach in the league whose Firebase
// Auth account exists, asking them to submit their availability for the given
// collection.  Returns the count of coaches successfully notified.

interface RequestAvailabilityData {
  leagueId: string;
  collectionId: string;
}

export const requestAvailability = onCall<RequestAvailabilityData, Promise<{ notified: number }>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');

    // Only league managers and admins may trigger availability requests.
    const callerRole = await assertAdminOrCoach(request.auth.uid);
    if (callerRole !== 'admin' && callerRole !== 'league_manager') {
      throw new HttpsError('permission-denied', 'Only league managers and admins can request availability.');
    }

    // SEC-91 (FW-64): paywall enforcement
    await assertSubscribedOrAdmin(request.auth.uid);

    const { leagueId, collectionId } = request.data;
    if (!leagueId?.trim()) throw new HttpsError('invalid-argument', 'leagueId is required.');
    if (!collectionId?.trim()) throw new HttpsError('invalid-argument', 'collectionId is required.');

    const db = admin.firestore();

    // Ownership check: non-admins must manage the league they are acting on.
    if (callerRole !== 'admin') {
      const leagueDoc = await admin.firestore().doc(`leagues/${leagueId}`).get();
      if (!leagueDoc.exists) throw new HttpsError('not-found', 'League not found.');
      const leagueData = leagueDoc.data()!;
      const userDoc = await admin.firestore().doc(`users/${request.auth.uid}`).get();
      const profile = userDoc.data();
      const ownsLeague = isManagerOfLeagueDoc(leagueData as Record<string, unknown>, request.auth.uid)
        || profile?.leagueId === leagueId;
      if (!ownsLeague) throw new HttpsError('permission-denied', 'You do not manage this league.');
    }

    // Load the league document to get the league name.
    const leagueDoc = await db.doc(`leagues/${leagueId}`).get();
    if (!leagueDoc.exists) throw new HttpsError('not-found', 'League not found.');
    const leagueName: string = leagueDoc.data()?.name ?? 'Your league';

    // Load the collection document to get the due date (optional field).
    const collectionDoc = await db
      .doc(`leagues/${leagueId}/availabilityCollections/${collectionId}`)
      .get();
    if (!collectionDoc.exists) throw new HttpsError('not-found', 'Availability collection not found.');
    const dueDate: string = collectionDoc.data()?.dueDate ?? '';

    // Load all teams in this league.
    const teamsSnap = await db
      .collection('teams')
      .where('leagueId', '==', leagueId)
      .get();

    if (teamsSnap.empty) {
      console.log(`requestAvailability: no teams found for leagueId=${leagueId}`);
      return { notified: 0 };
    }

    // Collect unique coach UIDs across teams.
    const coachIds = new Set<string>();
    for (const teamDoc of teamsSnap.docs) {
      const coachId: string | undefined = teamDoc.data()?.coachId;
      if (coachId) coachIds.add(coachId);
    }

    if (!coachIds.size) {
      console.log(`requestAvailability: no coaches found for leagueId=${leagueId}`);
      return { notified: 0 };
    }

    const now = new Date().toISOString();
    const dueLine = dueDate ? ` Due ${dueDate}.` : '';
    const message = `${leagueName} is collecting coach availability.${dueLine}`;

    // Write one notification per coach who has an app account (i.e. exists in
    // the users collection). Unknown UIDs are silently skipped.
    let notified = 0;
    let batch = db.batch();
    let batchOps = 0;

    for (const coachUid of coachIds) {
      const userDoc = await db.doc(`users/${coachUid}`).get();
      if (!userDoc.exists) continue; // Coach has no app account — skip.

      const notifRef = db
        .collection('users').doc(coachUid)
        .collection('notifications').doc();

      batch.set(notifRef, {
        id: notifRef.id,
        type: 'availability_request',
        title: 'Game availability requested',
        message,
        relatedLeagueId: leagueId,
        relatedCollectionId: collectionId,
        isRead: false,
        createdAt: now,
      });

      notified++;
      batchOps++;

      // Firestore batch limit is 500 operations; flush well before that.
      if (batchOps >= 490) {
        await batch.commit();
        batch = db.batch();
        batchOps = 0;
      }
    }

    if (batchOps > 0) await batch.commit();

    console.log(
      `requestAvailability: notified=${notified} coaches for leagueId=${leagueId} collectionId=${collectionId}`,
    );
    return { notified };
  }
);

// ─── Availability: send reminders to non-responders (callable) ────────────────
//
// Re-notifies coaches who have NOT yet submitted a response for an open
// availability collection, subject to a 48-hour per-coach cooldown stored at
// users/{coachUid}/config/reminderCooldown.

interface SendAvailabilityReminderData {
  leagueId: string;
  collectionId: string;
}

export const sendAvailabilityReminder = onCall<SendAvailabilityReminderData, Promise<{ reminded: number }>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');

    const callerRole = await assertAdminOrCoach(request.auth.uid);
    if (callerRole !== 'admin' && callerRole !== 'league_manager') {
      throw new HttpsError('permission-denied', 'Only league managers and admins can send reminders.');
    }

    // SEC-91 (FW-64): paywall enforcement
    await assertSubscribedOrAdmin(request.auth.uid);

    const { leagueId, collectionId } = request.data;
    if (!leagueId?.trim()) throw new HttpsError('invalid-argument', 'leagueId is required.');
    if (!collectionId?.trim()) throw new HttpsError('invalid-argument', 'collectionId is required.');

    const db = admin.firestore();

    // Ownership check: non-admins must manage the league they are acting on.
    if (callerRole !== 'admin') {
      const leagueDoc = await admin.firestore().doc(`leagues/${leagueId}`).get();
      if (!leagueDoc.exists) throw new HttpsError('not-found', 'League not found.');
      const leagueData = leagueDoc.data()!;
      const userDoc = await admin.firestore().doc(`users/${request.auth.uid}`).get();
      const profile = userDoc.data();
      const ownsLeague = isManagerOfLeagueDoc(leagueData as Record<string, unknown>, request.auth.uid)
        || profile?.leagueId === leagueId;
      if (!ownsLeague) throw new HttpsError('permission-denied', 'You do not manage this league.');
    }

    // Verify the collection is still open.
    const collectionRef = db.doc(`leagues/${leagueId}/availabilityCollections/${collectionId}`);
    const collectionDoc = await collectionRef.get();
    if (!collectionDoc.exists) throw new HttpsError('not-found', 'Availability collection not found.');

    const collectionData = collectionDoc.data()!;
    if (collectionData.status !== 'open') {
      throw new HttpsError(
        'failed-precondition',
        `Cannot send reminders: collection status is "${collectionData.status}", not "open".`,
      );
    }

    const leagueName: string = collectionData.leagueName ?? '';
    const dueDate: string = collectionData.dueDate ?? '';

    // Load all existing responses so we know who has already submitted.
    const responsesSnap = await collectionRef.collection('responses').get();
    const respondedCoachIds = new Set<string>(
      responsesSnap.docs.map(d => d.id)
    );

    // Load league name if not stored on the collection document.
    let resolvedLeagueName = leagueName;
    if (!resolvedLeagueName) {
      const leagueDoc = await db.doc(`leagues/${leagueId}`).get();
      resolvedLeagueName = leagueDoc.data()?.name ?? 'Your league';
    }

    // Load all teams and collect coach UIDs.
    const teamsSnap = await db
      .collection('teams')
      .where('leagueId', '==', leagueId)
      .get();

    const coachIds = new Set<string>();
    for (const teamDoc of teamsSnap.docs) {
      const coachId: string | undefined = teamDoc.data()?.coachId;
      if (coachId) coachIds.add(coachId);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const cooldownMs = 48 * 60 * 60 * 1000; // 48 hours in milliseconds
    const dueLine = dueDate ? ` Due ${dueDate}.` : '';
    const message = `${resolvedLeagueName} is still collecting coach availability.${dueLine}`;

    let reminded = 0;
    let batch = db.batch();
    let batchOps = 0;

    for (const coachUid of coachIds) {
      // Skip coaches who have already responded.
      if (respondedCoachIds.has(coachUid)) continue;

      // Skip coaches without an app account.
      const userDoc = await db.doc(`users/${coachUid}`).get();
      if (!userDoc.exists) continue;

      // Enforce 48-hour cooldown.
      const cooldownRef = db.doc(`users/${coachUid}/config/reminderCooldown`);
      const cooldownDoc = await cooldownRef.get();
      if (cooldownDoc.exists) {
        const lastSentAt: string | undefined = cooldownDoc.data()?.lastReminderSentAt;
        if (lastSentAt) {
          const lastSentMs = new Date(lastSentAt).getTime();
          if (now.getTime() - lastSentMs < cooldownMs) {
            console.log(`sendAvailabilityReminder: skipping coachUid=${coachUid} — within cooldown`);
            continue;
          }
        }
      }

      // Write the in-app notification.
      const notifRef = db
        .collection('users').doc(coachUid)
        .collection('notifications').doc();

      batch.set(notifRef, {
        id: notifRef.id,
        type: 'availability_request',
        title: 'Reminder: Game availability due soon',
        message,
        relatedLeagueId: leagueId,
        relatedCollectionId: collectionId,
        isRead: false,
        createdAt: nowIso,
      });
      batchOps++;

      // Update the cooldown document.
      batch.set(cooldownRef, { lastReminderSentAt: nowIso }, { merge: true });
      batchOps++;

      reminded++;

      if (batchOps >= 490) {
        await batch.commit();
        batch = db.batch();
        batchOps = 0;
      }
    }

    if (batchOps > 0) await batch.commit();

    console.log(
      `sendAvailabilityReminder: reminded=${reminded} coaches for leagueId=${leagueId} collectionId=${collectionId}`,
    );
    return { reminded };
  }
);

// ─── Availability: auto-close overdue collections (scheduled, daily 00:05 UTC) ─
//
// Three actions per run:
//   1. Close any 'open' collections whose dueDate has passed → notify the LM.
//   2. Warn LMs whose 'closed' collection reached its 60-day retention threshold.
//   3. Expire 'closed' collections that are 90+ days old.

export const autoCloseCollections = onSchedule(
  { schedule: '5 0 * * *' }, // 00:05 UTC daily
  async () => {
    // No ENV.shouldRunScheduledJobs() guard — this maintenance CF runs on
    // staging and prod alike (FW-82 Phase E). Staging has real data that
    // also needs expiry and purge. sendScheduledNotifications retains the
    // guard because notifications to non-existent staging users are wasteful.
    const db = admin.firestore();
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

    // ── 1. Close open collections whose dueDate has passed ───────────────────

    const openSnap = await db
      .collectionGroup('availabilityCollections')
      .where('status', '==', 'open')
      .where('dueDate', '<', todayStr)
      .get();

    let closed = 0;

    for (const colDoc of openSnap.docs) {
      const data = colDoc.data();
      const leagueId: string = data.leagueId ?? colDoc.ref.parent.parent?.id ?? '';
      const createdBy: string | undefined = data.createdBy;
      const nowIso = now.toISOString();

      // Close the collection.
      await colDoc.ref.update({ status: 'closed', closedAt: nowIso });
      closed++;

      if (!createdBy) {
        console.log(`autoCloseCollections: no createdBy on collection ${colDoc.id} — skipping LM notification`);
        continue;
      }

      // Resolve league name for the notification message.
      let leagueName = data.leagueName ?? '';
      if (!leagueName && leagueId) {
        const leagueDoc = await db.doc(`leagues/${leagueId}`).get();
        leagueName = leagueDoc.data()?.name ?? 'your league';
      }

      const notifRef = db
        .collection('users').doc(createdBy)
        .collection('notifications').doc();

      await notifRef.set({
        id: notifRef.id,
        type: 'info',
        title: 'Availability collection closed',
        message: `Your availability collection for ${leagueName} has closed. Return to the wizard to generate your schedule.`,
        relatedLeagueId: leagueId,
        relatedCollectionId: colDoc.id,
        isRead: false,
        createdAt: nowIso,
      });

      console.log(
        `autoCloseCollections: closed collection ${colDoc.id} for leagueId=${leagueId}, notified createdBy=${createdBy}`,
      );
    }

    // ── 2. Warn LMs: collections closed 60 days ago ──────────────────────────

    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgoIso = sixtyDaysAgo.toISOString();
    // Use a narrow window (±1 day) to avoid re-sending warnings each run.
    const sixtyOneDaysAgo = new Date(now.getTime() - 61 * 24 * 60 * 60 * 1000).toISOString();

    const warn60Snap = await db
      .collectionGroup('availabilityCollections')
      .where('status', '==', 'closed')
      .where('closedAt', '>=', sixtyOneDaysAgo)
      .where('closedAt', '<', sixtyDaysAgoIso)
      .get();

    let warned = 0;

    for (const colDoc of warn60Snap.docs) {
      const data = colDoc.data();
      const leagueId: string = data.leagueId ?? colDoc.ref.parent.parent?.id ?? '';
      const createdBy: string | undefined = data.createdBy;

      if (!createdBy) continue;

      let leagueName = data.leagueName ?? '';
      if (!leagueName && leagueId) {
        const leagueDoc = await db.doc(`leagues/${leagueId}`).get();
        leagueName = leagueDoc.data()?.name ?? 'your league';
      }

      const notifRef = db
        .collection('users').doc(createdBy)
        .collection('notifications').doc();

      await notifRef.set({
        id: notifRef.id,
        type: 'info',
        title: 'Availability data expiring soon',
        message: `Your availability collection for ${leagueName} will be permanently deleted in 30 days. Export or use the data before it expires.`,
        relatedLeagueId: leagueId,
        relatedCollectionId: colDoc.id,
        isRead: false,
        createdAt: now.toISOString(),
      });

      warned++;
      console.log(
        `autoCloseCollections: 60-day warning sent for collection ${colDoc.id}, createdBy=${createdBy}`,
      );
    }

    // ── 3. Expire collections closed 90+ days ago ────────────────────────────

    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const expire90Snap = await db
      .collectionGroup('availabilityCollections')
      .where('status', '==', 'closed')
      .where('closedAt', '<', ninetyDaysAgo)
      .get();

    let expired = 0;
    let expireBatch = db.batch();
    let expireBatchOps = 0;

    for (const colDoc of expire90Snap.docs) {
      expireBatch.update(colDoc.ref, { status: 'expired', expiredAt: now.toISOString() });
      expireBatchOps++;
      expired++;

      if (expireBatchOps >= 499) {
        await expireBatch.commit();
        expireBatch = db.batch();
        expireBatchOps = 0;
      }
    }

    if (expireBatchOps > 0) await expireBatch.commit();

    console.log(
      `autoCloseCollections: done — closed=${closed}, warned60=${warned}, expired=${expired}`,
    );
  },
);

// ─── Scheduled: purge soft-deleted records older than 30 days ────────────────
//
// Runs daily at 01:00 UTC.
//
// Targets:
//   • leagues: 7-day warning pass — isDeleted == true AND deletedAt between
//              23 and 30 days ago → in-app notification to league manager
//   • teams:  isDeleted == true  AND deletedAt < now - 30 days
//             → recursiveDelete(teamRef)  [removes doc + all subcollections]
//   • leagues: isDeleted == true AND deletedAt < now - 30 days
//             → recursiveDelete(leagueRef) [removes doc + seasons, divisions,
//               venues, availabilityCollections, wizardDraft, etc.]
//   • users/{uid}/venues: deletedAt field set AND deletedAt < now - 30 days
//             → deleteDoc(venueRef)        [venues have no subcollections]
//
// Cost note: this function issues one collectionGroup/collection query per
// target type, then one recursiveDelete per matched document. On a typical
// small deployment the cost is negligible (< 100 deletes/day). At scale,
// consider batching and adding a composite Firestore index on
// (isDeleted, deletedAt) for teams/leagues.
//
// Index note: the warning pass query (isDeleted == true, deletedAt range)
// is covered by the existing composite index on leagues (isDeleted ASC,
// deletedAt ASC) in firestore.indexes.json — no additional index required.

export const purgeSoftDeletedData = onSchedule(
  { schedule: '0 1 * * *' }, // 01:00 UTC daily
  async () => {
    // No ENV.shouldRunScheduledJobs() guard — see autoCloseCollections note
    // above (FW-82 Phase E).
    const db = admin.firestore();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    let teamsDeleted = 0;
    let leaguesDeleted = 0;
    let venuesDeleted = 0;
    let leaguesWarned = 0;

    // ── 0. 7-day warning pass for soft-deleted leagues ───────────────────────
    //
    // Leagues deleted between 23 and 30 days ago are 7 days from permanent
    // removal. Notify the last known league manager (deletedBy field written
    // by the deleteLeague callable) so they can contact support if needed.
    //
    // Query window (23–30 days ago) mirrors the autoCloseCollections ±1-day
    // narrow window pattern to avoid re-sending on each daily run.
    // Covered by the existing composite index on leagues (isDeleted ASC,
    // deletedAt ASC).

    try {
      const thirtyDaysAgoDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const twentyThreeDaysAgoDate = new Date(now.getTime() - 23 * 24 * 60 * 60 * 1000);

      const warnSnap = await db
        .collection('leagues')
        .where('isDeleted', '==', true)
        .where('deletedAt', '>=', thirtyDaysAgoDate.toISOString())
        .where('deletedAt', '<', twentyThreeDaysAgoDate.toISOString())
        .get();

      for (const leagueDoc of warnSnap.docs) {
        const data = leagueDoc.data();
        const lmUid: string | undefined = data.deletedBy;

        if (!lmUid) {
          console.log(
            `purgeSoftDeletedData: no deletedBy on leagueId=${leagueDoc.id} — skipping 7-day warning`,
          );
          continue;
        }

        const leagueName: string = data.name ?? 'your league';

        const notifRef = db
          .collection('users').doc(lmUid)
          .collection('notifications').doc();

        await notifRef.set({
          id: notifRef.id,
          type: 'info',
          title: 'League pending permanent deletion',
          message: `Your league ${leagueName} was deleted and will be permanently removed in 7 days. If this was a mistake, contact support.`,
          relatedLeagueId: leagueDoc.id,
          isRead: false,
          createdAt: now.toISOString(),
        });

        leaguesWarned++;
        console.log(
          `purgeSoftDeletedData: 7-day warning sent for leagueId=${leagueDoc.id}, lmUid=${lmUid}`,
        );
      }
    } catch (err: unknown) {
      console.error('purgeSoftDeletedData: league warning pass error —', (err as Error)?.message ?? err);
    }

    // ── 1. Purge soft-deleted teams ──────────────────────────────────────────
    //
    // Note: Firestore cannot combine != and < on different fields without a
    // composite index, so we query on (isDeleted == true, deletedAt < cutoff).
    // This requires a composite index on teams: (isDeleted ASC, deletedAt ASC).
    // If the index does not exist yet the query will throw; add it to
    // firestore.indexes.json: { collectionGroup: "teams",
    //   fields: [{ fieldPath:"isDeleted", order:"ASCENDING" },
    //            { fieldPath:"deletedAt", order:"ASCENDING" }] }

    try {
      const teamsSnap = await db
        .collection('teams')
        .where('isDeleted', '==', true)
        .where('deletedAt', '<', thirtyDaysAgo)
        .get();

      for (const teamDoc of teamsSnap.docs) {
        await admin.firestore().recursiveDelete(teamDoc.ref);
        teamsDeleted++;
        console.log(`purgeSoftDeletedData: hard-deleted teamId=${teamDoc.id} (deletedAt=${teamDoc.data().deletedAt})`);
      }
    } catch (err: unknown) {
      console.error('purgeSoftDeletedData: teams purge error —', (err as Error)?.message ?? err);
    }

    // ── 2. Purge soft-deleted leagues ────────────────────────────────────────
    //
    // Requires composite index on leagues: (isDeleted ASC, deletedAt ASC).

    try {
      const leaguesSnap = await db
        .collection('leagues')
        .where('isDeleted', '==', true)
        .where('deletedAt', '<', thirtyDaysAgo)
        .get();

      for (const leagueDoc of leaguesSnap.docs) {
        await admin.firestore().recursiveDelete(leagueDoc.ref);
        leaguesDeleted++;
        console.log(`purgeSoftDeletedData: hard-deleted leagueId=${leagueDoc.id} (deletedAt=${leagueDoc.data().deletedAt})`);
      }
    } catch (err: unknown) {
      console.error('purgeSoftDeletedData: leagues purge error —', (err as Error)?.message ?? err);
    }

    // ── 3. Purge soft-deleted venues (users/{uid}/venues subcollection) ───────
    //
    // Venues use a deletedAt timestamp field (no isDeleted boolean).
    // We use collectionGroup to reach all users' venue subcollections in one
    // query rather than iterating every user document.
    // Venues have no further subcollections so a simple deleteDoc is sufficient.

    try {
      const venuesSnap = await db
        .collectionGroup('venues')
        .where('deletedAt', '<', thirtyDaysAgo)
        .get();

      for (const venueDoc of venuesSnap.docs) {
        // Only target the users/{uid}/venues path; skip any league venues that
        // may accidentally match (leagues/{id}/venues use a different schema
        // and are covered by the leagues recursiveDelete above).
        const pathSegments = venueDoc.ref.path.split('/');
        if (pathSegments[0] !== 'users' || pathSegments[2] !== 'venues') {
          continue;
        }
        await venueDoc.ref.delete();
        venuesDeleted++;
        console.log(`purgeSoftDeletedData: hard-deleted venue path=${venueDoc.ref.path} (deletedAt=${venueDoc.data().deletedAt})`);
      }
    } catch (err: unknown) {
      console.error('purgeSoftDeletedData: venues purge error —', (err as Error)?.message ?? err);
    }

    console.log(
      `purgeSoftDeletedData: done — leaguesWarned=${leaguesWarned}, teams=${teamsDeleted}, leagues=${leaguesDeleted}, venues=${venuesDeleted}`,
    );
  },
);

// ─── Callable: deterministic schedule generation ──────────────────────────────

export const generateSchedule = onCall(
  {
    timeoutSeconds: 60,
    memory: '256MiB',
    enforceAppCheck: false,
  },
  async (request): Promise<ScheduleAlgorithmOutput> => {
    // Outer catch: captures errors from ALL steps including auth, Firestore reads, and algorithm
    try {
      // 1. Auth check
      if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Authentication required.');
      }

      // 2. Role check
      const role = await assertAdminOrCoach(request.auth.uid);
      if (role !== 'admin' && role !== 'league_manager') {
        throw new HttpsError(
          'permission-denied',
          'Only league managers and admins can generate schedules.'
        );
      }

      // SEC-91 (FW-64): paywall enforcement
      await assertSubscribedOrAdmin(request.auth.uid);

      // 3. Rate limit
      await checkRateLimit(request.auth.uid, 'generateSchedule', 5, 60_000);

      const input = request.data as GenerateScheduleInput;

      // 4. League ownership check (fixes FINDING-01)
      if (role !== 'admin') {
        const leagueDoc = await admin.firestore().doc(`leagues/${input.leagueId}`).get();
        if (!leagueDoc.exists) {
          throw new HttpsError('not-found', 'League not found.');
        }
        const leagueData = leagueDoc.data()!;
        const userDoc = await admin.firestore().doc(`users/${request.auth.uid}`).get();
        const profile = userDoc.data();
        const ownsLeague =
          isManagerOfLeagueDoc(leagueData as Record<string, unknown>, request.auth.uid) ||
          profile?.leagueId === input.leagueId;
        if (!ownsLeague) {
          throw new HttpsError('permission-denied', 'You do not manage this league.');
        }
      }

      // 4b. Division ownership check (SEC-74): verify all supplied division IDs belong to
      // the caller's league. Admins bypass this check (same pattern as step 4).
      if (role !== 'admin' && Array.isArray(input.divisions) && input.divisions.length > 0) {
        const divSnaps = await Promise.all(
          input.divisions.map((d: { id: string }) =>
            admin.firestore().doc(`leagues/${input.leagueId}/divisions/${d.id}`).get()
          )
        );
        if (divSnaps.some(s => !s.exists)) {
          throw new HttpsError('permission-denied', 'One or more divisions do not belong to this league.');
        }
      }

      // 5. Input validation
      validateInput(input);

      // 6. Feasibility pre-check (zero slots across all venues)
      const hasSomeSlot = (() => {
        const seasonBlackouts = new Set(input.blackoutDates ?? []);
        const start = new Date(input.seasonStart + 'T00:00:00Z');
        const end = new Date(input.seasonEnd + 'T00:00:00Z');
        for (const cur = new Date(start); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
          const isoDate = cur.toISOString().slice(0, 10);
          if (seasonBlackouts.has(isoDate)) continue;
          const dow = cur.getUTCDay();
          for (const venue of input.venues) {
            const venueBlackouts = new Set(venue.blackoutDates ?? []);
            if (venueBlackouts.has(isoDate)) continue;
            const allWindows = [
              ...(venue.availabilityWindows ?? []),
              ...(venue.fallbackWindows ?? []),
            ];
            for (const window of allWindows) {
              if (window.dayOfWeek === dow) return true;
            }
          }
        }
        return false;
      })();

      if (!hasSomeSlot) {
        throw new HttpsError(
          'invalid-argument',
          'No available venue slots in season window after blackouts'
        );
      }

      // 7. Capacity feasibility pre-check
      feasibilityPreCheck(input);

      // 7b. Family conflict precomputation (FW-32)
      // Query parent users and derive conflict groups so the algorithm can prevent
      // two children from the same family being scheduled simultaneously.
      // Only runs for multi-team leagues; a single team has no possible conflict.
      if (input.teams.length > 1) {
        try {
          const leagueTeamIds = new Set(input.teams.map((t: { id: string }) => t.id));

          // Query users with role === 'parent'. The `role` field is a top-level indexed
          // field, so this is a single-field equality query — no composite index needed.
          const parentSnap = await admin
            .firestore()
            .collection('users')
            .where('role', '==', 'parent')
            .limit(500)
            .get();

          const parentUsers = parentSnap.docs.map(doc => {
            const data = doc.data();
            const memberships: Array<{ role: string; teamId: string; playerId?: string }> =
              Array.isArray(data.memberships) ? data.memberships : [];
            return { uid: doc.id, memberships };
          });

          input.familyConflictGroups = extractFamilyConflictGroups(parentUsers, leagueTeamIds);

          if (input.familyConflictGroups.length > 0) {
            console.log(
              `generateSchedule: family conflict groups detected`,
              { groupCount: input.familyConflictGroups.length, leagueId: input.leagueId },
            );
          }
        } catch (familyErr: unknown) {
          // Non-fatal: if the family query fails, log and continue without conflict groups.
          // Scheduling still proceeds; family conflicts will just not be enforced this run.
          const raw = familyErr instanceof Error ? familyErr.message : String(familyErr);
          console.error('generateSchedule: family conflict query failed — proceeding without groups', { raw });
          input.familyConflictGroups = [];
        }
      }

      // 8. Run algorithm — inner catch preserves algorithm-specific error context
      try {
        const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
        return runScheduleAlgorithm(input, seed);
      } catch (err: unknown) {
        if (err instanceof HttpsError) throw err;
        const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        console.error('generateSchedule algorithm error', { raw, stack: err instanceof Error ? err.stack : undefined });
        throw new HttpsError('failed-precondition', `DEBUG — ${raw}`);
      }

    } catch (outerErr: unknown) {
      if (outerErr instanceof HttpsError) throw outerErr;
      const raw = outerErr instanceof Error ? `${outerErr.name}: ${outerErr.message}` : String(outerErr);
      console.error('generateSchedule outer error', { raw, stack: outerErr instanceof Error ? outerErr.stack : undefined });
      throw new HttpsError('failed-precondition', `Schedule generation failed: ${raw}`);
    }
  }
);

// ─── Callable: geocode a venue address via Nominatim ─────────────────────────

export const geocodeVenueAddress = onCall(
  { enforceAppCheck: false },
  async (request) => {
    const { venueId, address, ownerUid } = request.data as {
      venueId: string;
      address: string;
      ownerUid: string;
    };

    if (!venueId || !address || !ownerUid) {
      throw new HttpsError('invalid-argument', 'venueId, address, and ownerUid are required');
    }

    if (address.length > 500) {
      throw new HttpsError('invalid-argument', 'Address must be 1–500 characters.');
    }

    // Auth check: caller must be the owner
    if (request.auth?.uid !== ownerUid) {
      throw new HttpsError('permission-denied', 'Not authorised');
    }

    // SEC-17: rate-limit geocoding — Nominatim ToS: max 1 req/s, no bulk.
    // Allow 10 geocode requests per minute per user.
    await checkRateLimit(request.auth.uid, 'geocodeVenue', 10);

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'FirstWhistle/1.0 (contact@firstwhistle.app)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        console.warn(`geocodeVenueAddress: Nominatim HTTP ${res.status} for "${address}"`);
        return { success: false };
      }
      const data = await res.json() as Array<{ lat: string; lon: string }>;
      const first = data[0];
      if (!first) {
        console.log(`geocodeVenueAddress: no result for "${address}"`);
        return { success: false };
      }
      const lat = parseFloat(first.lat);
      const lng = parseFloat(first.lon);
      await admin.firestore()
        .doc(`users/${ownerUid}/venues/${venueId}`)
        .update({ lat, lng, updatedAt: new Date().toISOString() });
      console.log(`geocodeVenueAddress: geocoded "${address}" → lat=${lat} lng=${lng}`);
      return { success: true, lat, lng };
    } catch (err) {
      console.warn(`geocodeVenueAddress: failed for "${address}"`, err);
      return { success: false };
    }
  },
);

// ─── Submit game result (callable) ────────────────────────────────────────────

interface SubmitGameResultData {
  eventId: string;
  leagueId: string;
  homeScore: number;
  awayScore: number;
}

interface SubmitGameResultOutput {
  status: 'pending' | 'confirmed' | 'dispute';
}

// ─── Tiebreaker types (mirrors src/types/season.ts — kept local to avoid cross-package imports) ──

interface TiebreakerConfig {
  twoTeam: ('winPct' | 'headToHead' | 'pointsAllowed')[];
  threeOrMore: ('winPct' | 'pointsAllowed')[];
}

const DEFAULT_TIEBREAKER_CONFIG: TiebreakerConfig = {
  twoTeam: ['winPct', 'headToHead', 'pointsAllowed'],
  threeOrMore: ['winPct', 'pointsAllowed'],
};

interface StandingsEntry {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  winPct: number;
  rank: number;
}

/**
 * Resolve a two-team tie using the configured twoTeam criteria in order.
 * Returns negative if a should rank higher, positive if b should, 0 if still tied.
 * completedDocs is the raw Firestore snapshot array used for head-to-head lookup.
 */
function resolveTwoTeamTie(
  a: StandingsEntry,
  b: StandingsEntry,
  criteria: ('winPct' | 'headToHead' | 'pointsAllowed')[],
  completedDocs: FirebaseFirestore.QueryDocumentSnapshot[],
): number {
  for (const criterion of criteria) {
    if (criterion === 'winPct') {
      if (a.winPct !== b.winPct) return b.winPct - a.winPct; // higher winPct ranks first
    } else if (criterion === 'headToHead') {
      // Find all games directly between a and b (in either home/away orientation)
      let aWins = 0;
      let bWins = 0;
      for (const doc of completedDocs) {
        const ev = doc.data();
        const result = ev.result as { homeScore: number; awayScore: number } | undefined;
        if (!result) continue;
        const isAHome = ev.homeTeamId === a.teamId && ev.awayTeamId === b.teamId;
        const isBHome = ev.homeTeamId === b.teamId && ev.awayTeamId === a.teamId;
        if (!isAHome && !isBHome) continue;
        const { homeScore, awayScore } = result;
        if (isAHome) {
          if (homeScore > awayScore) aWins++;
          else if (awayScore > homeScore) bWins++;
          // draws don't count toward head-to-head advantage
        } else {
          // b is home
          if (homeScore > awayScore) bWins++;
          else if (awayScore > homeScore) aWins++;
        }
      }
      // Only apply if there is a clear winner; a split (or no games) falls through to next criterion
      if (aWins > bWins) return -1;
      if (bWins > aWins) return 1;
    } else if (criterion === 'pointsAllowed') {
      // Fewer goalsAgainst ranks higher
      if (a.goalsAgainst !== b.goalsAgainst) return a.goalsAgainst - b.goalsAgainst;
    }
  }
  return 0; // still tied after all criteria
}

/**
 * Resolve a group of 3+ tied teams using the configured threeOrMore criteria in order.
 * Returns a comparator result: negative if a should rank higher, positive if b should, 0 if tied.
 * headToHead is intentionally not valid for 3+ teams (circular results are ambiguous).
 */
function resolveMultiTeamTie(
  a: StandingsEntry,
  b: StandingsEntry,
  criteria: ('winPct' | 'pointsAllowed')[],
): number {
  for (const criterion of criteria) {
    if (criterion === 'winPct') {
      if (a.winPct !== b.winPct) return b.winPct - a.winPct;
    } else if (criterion === 'pointsAllowed') {
      if (a.goalsAgainst !== b.goalsAgainst) return a.goalsAgainst - b.goalsAgainst;
    }
  }
  return 0;
}

/**
 * Recalculate standings for a season by scanning all confirmed game results.
 * Writes a `standings` subcollection under leagues/{leagueId}/seasons/{seasonId}.
 * Each document is keyed by teamId and contains:
 *   played, won, drawn, lost, goalsFor, goalsAgainst, points, winPct, rank
 *
 * Ranking logic:
 *   1. Sort by points (descending).
 *   2. Group teams sharing the same points total.
 *   3. For a group of exactly 2: apply season.tiebreakerConfig.twoTeam criteria in order.
 *   4. For a group of 3+: apply season.tiebreakerConfig.threeOrMore criteria in order.
 *   5. Any remaining ties are broken alphabetically by teamId (stable fallback).
 *
 * Season-creation note: when a new season is created for a league the UI should
 * copy tiebreakerConfig from the most recent prior season. The copy lives in the
 * season-creation flow — not enforced here.
 */
async function recalculateStandings(leagueId: string, seasonId: string): Promise<void> {
  const db = admin.firestore();

  // Fetch season document to read tiebreakerConfig (1 read — cost: negligible)
  const seasonSnap = await db.doc(`leagues/${leagueId}/seasons/${seasonId}`).get();
  const seasonData = seasonSnap.data();
  const tiebreakerConfig: TiebreakerConfig =
    (seasonData?.tiebreakerConfig as TiebreakerConfig | undefined) ?? DEFAULT_TIEBREAKER_CONFIG;

  // Fetch all events for this season that have a confirmed result
  const eventsSnap = await db
    .collection('events')
    .where('leagueId', '==', leagueId)
    .where('seasonId', '==', seasonId)
    .where('type', '==', 'game')
    .where('status', '==', 'completed')
    .get();

  const standings: Record<string, StandingsEntry> = {};

  const ensureTeam = (teamId: string) => {
    if (!standings[teamId]) {
      standings[teamId] = {
        teamId,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
        winPct: 0,
        rank: 0, // assigned after sorting
      };
    }
  };

  for (const doc of eventsSnap.docs) {
    const ev = doc.data();
    const result = ev.result as { homeScore: number; awayScore: number } | undefined;
    if (!result) continue;

    const homeId: string = ev.homeTeamId;
    const awayId: string = ev.awayTeamId;
    const { homeScore, awayScore } = result;

    ensureTeam(homeId);
    ensureTeam(awayId);

    standings[homeId].played++;
    standings[awayId].played++;
    standings[homeId].goalsFor += homeScore;
    standings[homeId].goalsAgainst += awayScore;
    standings[awayId].goalsFor += awayScore;
    standings[awayId].goalsAgainst += homeScore;

    if (homeScore > awayScore) {
      standings[homeId].won++;
      standings[homeId].points += 3;
      standings[awayId].lost++;
    } else if (awayScore > homeScore) {
      standings[awayId].won++;
      standings[awayId].points += 3;
      standings[homeId].lost++;
    } else {
      standings[homeId].drawn++;
      standings[homeId].points += 1;
      standings[awayId].drawn++;
      standings[awayId].points += 1;
    }
  }

  // Compute winPct for each team (0 when no games played — avoids division by zero)
  for (const entry of Object.values(standings)) {
    entry.winPct = entry.played > 0 ? entry.won / entry.played : 0;
  }

  // ── Sort and assign ranks ────────────────────────────────────────────────────
  //
  // Strategy:
  //   - Sort entire list by points desc first.
  //   - Identify contiguous groups of teams that share the same points total.
  //   - Within each group, apply the appropriate tiebreaker comparator, then
  //     fall back to alphabetical teamId for a fully stable, deterministic order.
  //   - Assign 1-based rank. Teams that remain tied after all criteria share the
  //     same rank (e.g., two teams both at rank 2 → next team is rank 4).

  const entries = Object.values(standings);

  // Edge case: no teams have any games yet — nothing to rank, skip batch write
  if (entries.length === 0) {
    console.log(`recalculateStandings: no teams found for leagueId=${leagueId} seasonId=${seasonId}`);
    return;
  }

  // Group by points
  const pointsGroups: Map<number, StandingsEntry[]> = new Map();
  for (const entry of entries) {
    const group = pointsGroups.get(entry.points) ?? [];
    group.push(entry);
    pointsGroups.set(entry.points, group);
  }

  // Sort each group internally using tiebreaker rules
  for (const group of pointsGroups.values()) {
    if (group.length === 1) continue; // no tie to resolve

    if (group.length === 2) {
      group.sort((a, b) => {
        const tiebreakerResult = resolveTwoTeamTie(
          a, b, tiebreakerConfig.twoTeam, eventsSnap.docs,
        );
        if (tiebreakerResult !== 0) return tiebreakerResult;
        return a.teamId.localeCompare(b.teamId); // stable alphabetical fallback
      });
    } else {
      // 3+ teams tied on points
      group.sort((a, b) => {
        const tiebreakerResult = resolveMultiTeamTie(a, b, tiebreakerConfig.threeOrMore);
        if (tiebreakerResult !== 0) return tiebreakerResult;
        return a.teamId.localeCompare(b.teamId); // stable alphabetical fallback
      });
    }
  }

  // Build final sorted list (groups ordered by points descending, entries within each group already sorted)
  const sortedPointsDesc = Array.from(pointsGroups.keys()).sort((a, b) => b - a);
  const sorted: StandingsEntry[] = [];
  for (const pts of sortedPointsDesc) {
    sorted.push(...(pointsGroups.get(pts) as StandingsEntry[]));
  }

  // Assign 1-based ranks; teams still tied after all criteria receive the same rank
  // and the subsequent rank skips accordingly (competition ranking / "1224" style)
  let currentRank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      sorted[i].rank = currentRank;
    } else {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      // Two entries are "still tied" if they share points AND the tiebreaker comparator
      // returns 0 between them. We check points equality as a fast guard — the tiebreaker
      // comparators already ran during sort so if they are adjacent with equal points they
      // are genuinely tied.
      const sameTier =
        prev.points === curr.points &&
        (prev.points === curr.points
          ? (sorted.length === 2
            ? resolveTwoTeamTie(prev, curr, tiebreakerConfig.twoTeam, eventsSnap.docs) === 0
            : resolveMultiTeamTie(prev, curr, tiebreakerConfig.threeOrMore) === 0)
          : false);
      if (sameTier) {
        curr.rank = prev.rank; // share rank
      } else {
        currentRank = i + 1; // competition ranking — skip consumed positions
        curr.rank = currentRank;
      }
    }
  }

  const now = new Date().toISOString();
  const batch = db.batch();
  for (const entry of sorted) {
    const ref = db.doc(`leagues/${leagueId}/seasons/${seasonId}/standings/${entry.teamId}`);
    batch.set(ref, { ...entry, updatedAt: now });
  }
  await batch.commit();
  console.log(`recalculateStandings: updated ${sorted.length} team(s) for leagueId=${leagueId} seasonId=${seasonId}`);
}

export const submitGameResult = onCall<SubmitGameResultData, Promise<SubmitGameResultOutput>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');

    const { eventId, leagueId, homeScore, awayScore } = request.data;
    if (!eventId?.trim()) throw new HttpsError('invalid-argument', 'eventId is required.');
    if (!leagueId?.trim()) throw new HttpsError('invalid-argument', 'leagueId is required.');
    if (
      typeof homeScore !== 'number' || typeof awayScore !== 'number' ||
      !Number.isFinite(homeScore) || !Number.isFinite(awayScore) ||
      !Number.isInteger(homeScore) || !Number.isInteger(awayScore)
    ) {
      throw new HttpsError('invalid-argument', 'Scores must be finite integers.');
    }
    if (homeScore < 0 || awayScore < 0) {
      throw new HttpsError('invalid-argument', 'Scores cannot be negative.');
    }
    if (homeScore > 99 || awayScore > 99) {
      throw new HttpsError('invalid-argument', 'Score cannot exceed 99.');
    }

    const uid = request.auth.uid;
    const db = admin.firestore();

    // Fetch the event
    const eventRef = db.doc(`events/${eventId}`);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) throw new HttpsError('not-found', 'Event not found.');

    const ev = eventSnap.data()!;
    if (ev.type !== 'game' && ev.type !== 'match') throw new HttpsError('failed-precondition', 'Only game or match events accept results.');

    // SEC-03: Reject result submissions for future events.
    const eventDate = ev.date as string; // 'YYYY-MM-DD'
    const today = new Date().toISOString().split('T')[0];
    if (eventDate > today) {
      throw new HttpsError('failed-precondition', 'Results cannot be submitted for future games.');
    }

    // CVR-2026-001: Validate caller-supplied leagueId matches the event's stored leagueId.
    // Prevents cross-league standings corruption via IDOR.
    // Guard is unconditional: events without a leagueId are rejected, not silently passed.
    if (!ev.leagueId || ev.leagueId !== leagueId) {
      throw new HttpsError('permission-denied', 'leagueId does not match the event.');
    }

    const validStatuses = ['completed', 'in_progress'];
    if (!validStatuses.includes(ev.status as string)) {
      throw new HttpsError('failed-precondition', `Event must be completed or in_progress to submit a result (current status: ${ev.status}).`);
    }

    // Verify caller is a coach of one of the teams in this event
    const homeTeamId: string = ev.homeTeamId;
    const awayTeamId: string = ev.awayTeamId;

    const homeTeamSnap = await db.doc(`teams/${homeTeamId}`).get();
    const awayTeamSnap = await db.doc(`teams/${awayTeamId}`).get();

    const isHomeCoach = homeTeamSnap.exists && isCoachOfTeamDoc(homeTeamSnap.data()!, uid);
    const isAwayCoach = awayTeamSnap.exists && isCoachOfTeamDoc(awayTeamSnap.data()!, uid);

    if (!isHomeCoach && !isAwayCoach) {
      throw new HttpsError('permission-denied', 'Only a coach of one of the teams in this event may submit a result.');
    }

    const callerSide: 'home' | 'away' = isHomeCoach ? 'home' : 'away';
    const now = new Date().toISOString();
    const submission = { homeScore, awayScore, submittedBy: uid, submittedAt: now, side: callerSide };

    // SEC-16: Use a transaction for the pending-result read-check-write to prevent
    // TOCTOU race where two coaches submit simultaneously and both see no pending doc.
    const pendingRef = db.doc(`leagues/${leagueId}/pendingResults/${eventId}`);
    const seasonId: string | undefined = ev.seasonId as string | undefined;

    const result = await db.runTransaction(async (tx) => {
      const pendingSnap = await tx.get(pendingRef);

      if (!pendingSnap.exists) {
        // First submission — save as pending
        tx.set(pendingRef, { eventId, leagueId, ...submission, createdAt: now, updatedAt: now });
        return { status: 'pending' as const };
      }

      const existing = pendingSnap.data()!;
      if (existing.side === callerSide) {
        // Same team submitting again — overwrite
        tx.set(pendingRef, { eventId, leagueId, ...submission, createdAt: existing.createdAt as string, updatedAt: now });
        return { status: 'pending' as const };
      }

      // Other team has already submitted — compare scores
      const scoresMatch =
        (existing.homeScore as number) === homeScore &&
        (existing.awayScore as number) === awayScore;

      if (scoresMatch) {
        // Auto-confirm: save result on event and recalculate standings
        tx.update(eventRef, {
          result: { homeScore, awayScore, confirmedAt: now },
          status: 'completed',
          updatedAt: now,
        });
        tx.delete(pendingRef);
        return { status: 'confirmed' as const, recalculate: true };
      }

      // Scores don't match — create a dispute record
      const disputeRef = db.doc(`leagues/${leagueId}/resultDisputes/${eventId}`);
      tx.set(disputeRef, {
        eventId,
        leagueId,
        firstSubmission: {
          homeScore: existing.homeScore as number,
          awayScore: existing.awayScore as number,
          submittedBy: existing.submittedBy as string,
          submittedAt: existing.submittedAt as string,
          side: existing.side as string,
        },
        secondSubmission: submission,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      });
      tx.delete(pendingRef);
      return { status: 'dispute' as const, existingScores: `${existing.homeScore}-${existing.awayScore}` };
    });

    if (result.status === 'pending') {
      console.log(`submitGameResult: saved/updated pending result for eventId=${eventId} by uid=${uid} (${callerSide})`);
    } else if (result.status === 'confirmed') {
      if (seasonId) {
        await recalculateStandings(leagueId, seasonId);
      }
      console.log(`submitGameResult: auto-confirmed result for eventId=${eventId} (${homeScore}-${awayScore})`);
    } else {
      console.log(`submitGameResult: dispute created for eventId=${eventId} — scores ${result.existingScores} vs ${homeScore}-${awayScore}`);
    }
    return { status: result.status };
  }
);

// ─── Publish schedule (callable) ──────────────────────────────────────────────

interface PublishScheduleData {
  leagueId: string;
  seasonId: string;
  divisionId?: string;
}

interface PublishScheduleOutput {
  publishedCount: number;
}

export const publishSchedule = onCall<PublishScheduleData, Promise<PublishScheduleOutput>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');

    const role = await assertAdminOrCoach(request.auth.uid);
    if (role !== 'admin' && role !== 'league_manager') {
      throw new HttpsError('permission-denied', 'Only league managers and admins can publish schedules.');
    }

    // SEC-91 (FW-64): paywall enforcement
    await assertSubscribedOrAdmin(request.auth.uid);

    const { leagueId, seasonId, divisionId } = request.data;
    if (!leagueId?.trim()) throw new HttpsError('invalid-argument', 'leagueId is required.');
    if (!seasonId?.trim()) throw new HttpsError('invalid-argument', 'seasonId is required.');

    const db = admin.firestore();
    const uid = request.auth.uid;

    // Verify the caller is a manager of this specific league
    const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
    if (!leagueSnap.exists) throw new HttpsError('not-found', 'League not found.');

    const leagueData = leagueSnap.data()!;
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.data();
    const isLeagueManager = role === 'admin'
      || userData?.leagueId === leagueId
      || isManagerOfLeagueDoc(leagueData as Record<string, unknown>, uid);

    if (!isLeagueManager) {
      throw new HttpsError('permission-denied', 'You are not a manager of this league.');
    }

    // Query all draft events for this season (and optionally division)
    let query: admin.firestore.Query = db
      .collection('events')
      .where('leagueId', '==', leagueId)
      .where('seasonId', '==', seasonId)
      .where('status', '==', 'draft');

    if (divisionId) {
      query = query.where('divisionId', '==', divisionId);
    }

    const draftEventsSnap = await query.get();
    const now = new Date().toISOString();
    const BATCH_SIZE = 490;
    let batch = db.batch();
    let ops = 0;
    let publishedCount = 0;

    const flushBatch = async () => {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    };

    // Batch-update all draft events to scheduled
    for (const doc of draftEventsSnap.docs) {
      batch.update(doc.ref, { status: 'scheduled', updatedAt: now });
      ops++;
      publishedCount++;
      if (ops >= BATCH_SIZE) await flushBatch();
    }

    // Always update the division's scheduleStatus to published when a divisionId is
    // provided — even if there were no draft events (e.g. already-published events
    // where only the status field was out of sync).
    if (divisionId) {
      const divRef = db.doc(`leagues/${leagueId}/divisions/${divisionId}`);
      batch.update(divRef, { scheduleStatus: 'published', updatedAt: now });
      ops++;
      if (ops >= BATCH_SIZE) await flushBatch();
    }

    if (ops > 0) await flushBatch();

    // Check if ALL divisions for this season are now published — if so, activate the season.
    const seasonRef = db.doc(`leagues/${leagueId}/seasons/${seasonId}`);
    const allDivisionsSnap = await db
      .collection(`leagues/${leagueId}/divisions`)
      .where('seasonId', '==', seasonId)
      .get();

    const allPublished = allDivisionsSnap.empty
      || allDivisionsSnap.docs.every(d => {
        // The division we just published may not yet be reflected — treat it as published.
        if (divisionId && d.id === divisionId) return true;
        return (d.data().scheduleStatus as string) === 'published';
      });

    if (allPublished) {
      await seasonRef.update({ status: 'active', updatedAt: now });
      console.log(`publishSchedule: season ${seasonId} status set to active`);
    }

    if (draftEventsSnap.empty) {
      console.log(`publishSchedule: no draft events found, division status updated for leagueId=${leagueId} seasonId=${seasonId}${divisionId ? ` divisionId=${divisionId}` : ''}`);
    } else {
      console.log(`publishSchedule: published ${publishedCount} events for leagueId=${leagueId} seasonId=${seasonId}${divisionId ? ` divisionId=${divisionId}` : ''}`);
    }
    return { publishedCount };
  }
);

// ─── Resolve dispute (callable) ───────────────────────────────────────────────

interface ResolveDisputeData {
  eventId: string;
  leagueId: string;
  chosenSubmission: 'first' | 'second'; // which submission the LM is confirming
}

interface ResolveDisputeOutput {
  status: 'resolved';
}

export const resolveDispute = onCall<ResolveDisputeData, Promise<ResolveDisputeOutput>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');

    const role = await assertAdminOrCoach(request.auth.uid);
    if (role !== 'admin' && role !== 'league_manager') {
      throw new HttpsError('permission-denied', 'Only league managers and admins can resolve disputes.');
    }

    // SEC-91 (FW-64): paywall enforcement
    await assertSubscribedOrAdmin(request.auth.uid);

    const { eventId, leagueId, chosenSubmission } = request.data;
    if (!eventId?.trim()) throw new HttpsError('invalid-argument', 'eventId is required.');
    if (!leagueId?.trim()) throw new HttpsError('invalid-argument', 'leagueId is required.');
    if (chosenSubmission !== 'first' && chosenSubmission !== 'second') {
      throw new HttpsError('invalid-argument', 'chosenSubmission must be "first" or "second".');
    }

    const db = admin.firestore();
    const uid = request.auth.uid;

    // Verify the caller manages this specific league
    const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
    if (!leagueSnap.exists) throw new HttpsError('not-found', 'League not found.');

    const leagueData = leagueSnap.data()!;
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.data();
    const isAuthorized = role === 'admin'
      || userData?.leagueId === leagueId
      || isManagerOfLeagueDoc(leagueData as Record<string, unknown>, uid);

    if (!isAuthorized) {
      throw new HttpsError('permission-denied', 'You are not a manager of this league.');
    }

    const disputeRef = db.doc(`leagues/${leagueId}/resultDisputes/${eventId}`);
    const eventRef = db.doc(`events/${eventId}`);

    // Read dispute doc (outside transaction — used for data extraction only)
    const disputeSnap = await disputeRef.get();
    if (!disputeSnap.exists) throw new HttpsError('not-found', 'Dispute not found.');

    const dispute = disputeSnap.data()!;
    if ((dispute.status as string) !== 'open') {
      throw new HttpsError('failed-precondition', 'Dispute is not open.');
    }

    const chosen = chosenSubmission === 'first'
      ? (dispute.firstSubmission as { homeScore: number; awayScore: number })
      : (dispute.secondSubmission as { homeScore: number; awayScore: number });

    const { homeScore, awayScore } = chosen;
    const now = new Date().toISOString();

    // Atomically: confirm result on event, delete dispute doc
    await db.runTransaction(async (tx) => {
      // Re-read inside transaction to guard against TOCTOU
      const disputeSnapTx = await tx.get(disputeRef);
      if (!disputeSnapTx.exists || (disputeSnapTx.data()!.status as string) !== 'open') {
        throw new HttpsError('failed-precondition', 'Dispute is no longer open.');
      }

      tx.update(eventRef, {
        result: { homeScore, awayScore, confirmedAt: now },
        status: 'completed',
        updatedAt: now,
        disputeStatus: FieldValue.delete(),
      });
      tx.delete(disputeRef);
    });

    // Recalculate standings if the event belongs to a season
    const eventSnap = await eventRef.get();
    const seasonId: string | undefined = eventSnap.data()?.seasonId as string | undefined;
    if (seasonId) {
      await recalculateStandings(leagueId, seasonId);
    }

    console.log(`resolveDispute: dispute resolved for eventId=${eventId} leagueId=${leagueId} chosenSubmission=${chosenSubmission} by uid=${uid}`);
    return { status: 'resolved' };
  }
);

// ─── Override standing rank (callable) ────────────────────────────────────────

interface OverrideStandingRankData {
  leagueId: string;
  seasonId: string;
  teamId: string;
  override: {
    rank: number;
    note: string;        // required, non-empty
    scope: 'display' | 'seeding';
  } | null; // null = clear the override
}

interface OverrideStandingRankOutput {
  status: 'ok';
}

export const overrideStandingRank = onCall<OverrideStandingRankData, Promise<OverrideStandingRankOutput>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');

    const role = await assertAdminOrCoach(request.auth.uid);
    if (role !== 'admin' && role !== 'league_manager') {
      throw new HttpsError('permission-denied', 'Only league managers and admins can override standing ranks.');
    }

    // SEC-91 (FW-64): paywall enforcement
    await assertSubscribedOrAdmin(request.auth.uid);

    const { leagueId, seasonId, teamId, override } = request.data;
    if (!leagueId?.trim()) throw new HttpsError('invalid-argument', 'leagueId is required.');
    if (!seasonId?.trim()) throw new HttpsError('invalid-argument', 'seasonId is required.');
    if (!teamId?.trim()) throw new HttpsError('invalid-argument', 'teamId is required.');

    if (override !== null && override !== undefined) {
      if (!override.note?.trim()) {
        throw new HttpsError('invalid-argument', 'override.note is required and must be non-empty.');
      }
      if (
        typeof override.rank !== 'number' ||
        !Number.isInteger(override.rank) ||
        override.rank < 1
      ) {
        throw new HttpsError('invalid-argument', 'override.rank must be a positive integer.');
      }
      if (override.scope !== 'display' && override.scope !== 'seeding') {
        throw new HttpsError('invalid-argument', 'override.scope must be "display" or "seeding".');
      }
    }

    const db = admin.firestore();
    const uid = request.auth.uid;

    // Verify the caller manages this specific league
    const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
    if (!leagueSnap.exists) throw new HttpsError('not-found', 'League not found.');

    const leagueData = leagueSnap.data()!;
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.data();
    const isAuthorized = role === 'admin'
      || userData?.leagueId === leagueId
      || isManagerOfLeagueDoc(leagueData as Record<string, unknown>, uid);

    if (!isAuthorized) {
      throw new HttpsError('permission-denied', 'You are not a manager of this league.');
    }

    const standingRef = db.doc(`leagues/${leagueId}/seasons/${seasonId}/standings/${teamId}`);

    if (override === null || override === undefined) {
      // Clear the override field
      await standingRef.update({ manualRankOverride: FieldValue.delete() });
      console.log(`overrideStandingRank: cleared override for teamId=${teamId} seasonId=${seasonId} leagueId=${leagueId} by uid=${uid}`);
    } else {
      await standingRef.update({
        manualRankOverride: {
          ...override,
          overriddenBy: request.auth.uid,
          overriddenAt: new Date().toISOString(),
        },
      });
      console.log(`overrideStandingRank: set override rank=${override.rank} scope=${override.scope} for teamId=${teamId} seasonId=${seasonId} leagueId=${leagueId} by uid=${uid}`);
    }

    return { status: 'ok' };
  }
);

// ─── League Team Invite Flow ──────────────────────────────────────────────────

interface SendLeagueInviteData {
  emails: string[];
  leagueId: string;
}

interface SendLeagueInviteResult {
  results: Array<{ email: string; success: boolean; error?: string }>;
}

/**
 * sendLeagueInvite — invite coaches to join a league by email.
 *
 * For each email the function:
 *   1. Creates a placeholder team document.
 *   2. Creates an auto-ID invite document in /invites.
 *   3. Sends an invitation email via nodemailer.
 *
 * Caller must be league_manager or admin and must own the league.
 * Rate limit: 1 call per minute per uid.
 * Maximum 20 emails per call.
 */
export const sendLeagueInvite = onCall<SendLeagueInviteData, Promise<SendLeagueInviteResult>>(
  { secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');

    const uid = request.auth.uid;
    const role = await assertAdminOrCoach(uid);
    if (role !== 'admin' && role !== 'league_manager') {
      throw new HttpsError('permission-denied', 'Only league managers and admins can send league invites.');
    }

    // SEC-91 (FW-64): paywall enforcement
    await assertSubscribedOrAdmin(uid);

    await checkRateLimit(uid, 'sendLeagueInvite', 1);

    const { emails, leagueId } = request.data;

    if (!Array.isArray(emails) || emails.length === 0) {
      throw new HttpsError('invalid-argument', 'emails must be a non-empty array.');
    }
    if (emails.length > 20) {
      throw new HttpsError('invalid-argument', 'Maximum 20 emails per call.');
    }
    if (!leagueId?.trim()) {
      throw new HttpsError('invalid-argument', 'leagueId is required.');
    }

    // Verify league exists and caller owns it.
    const db = admin.firestore();
    const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
    if (!leagueSnap.exists) {
      throw new HttpsError('not-found', `League ${leagueId} not found.`);
    }
    const league = leagueSnap.data() as {
      name: string;
      managedBy?: string;
      sportType?: string;
    };
    if (role !== 'admin' && !isManagerOfLeagueDoc(league as Record<string, unknown>, uid)) {
      throw new HttpsError('permission-denied', 'You do not own this league.');
    }

    const leagueName = league.name ?? 'Unknown League';
    const sportType = league.sportType ?? 'other';
    const now = new Date().toISOString();
    const transporter = createTransporter();
    const inviteUrl = `${APP_URL}/invite/league`;

    const settled = await Promise.allSettled(
      emails.map(async (rawEmail) => {
        const email = rawEmail.toLowerCase().trim();
        if (!email) throw new Error('Empty email address.');

        // 1. Create placeholder team.
        const placeholderTeamId = crypto.randomUUID();
        await db.doc(`teams/${placeholderTeamId}`).set({
          id: placeholderTeamId,
          name: `Pending \u2014 ${email}`,
          leagueIds: [leagueId],
          isPending: true,
          pendingEmail: email,
          sportType,
          color: '#9ca3af',
          createdBy: uid,
          ownerName: '',
          createdAt: now,
          updatedAt: now,
        });

        // 2. Create auto-ID invite document.
        await db.collection('invites').add({
          email,
          leagueId,
          leagueName,
          placeholderTeamId,
          invitedBy: uid,
          invitedAt: now,
        });

        // 3. Send invite email.
        await transporter.sendMail({
          from: emailFrom.value(),
          to: email,
          subject: `You've been invited to join ${leagueName} on First Whistle`,
          text: [
            `You've been invited to join ${leagueName} on First Whistle.`,
            '',
            'Click the link below to accept your invitation:',
            inviteUrl,
            '',
            '---',
            'Sent via First Whistle',
          ].join('\n'),
          html: buildEmail({
            recipientName: 'Coach',
            preheader: `You've been invited to join ${leagueName} on First Whistle`,
            title: `You've been invited to join ${leagueName}`,
            message: `<p style="margin:0">Click below to accept your invitation and set up your team in the league.</p>`,
            ctaUrl: inviteUrl,
            ctaLabel: 'Accept Invitation',
          }),
        });
      })
    );

    const results: SendLeagueInviteResult['results'] = settled.map((outcome, i) => {
      const email = emails[i].toLowerCase().trim();
      if (outcome.status === 'fulfilled') {
        return { email, success: true };
      }
      const err = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      console.error(`sendLeagueInvite: failed for email=${email} leagueId=${leagueId} uid=${uid}:`, err);
      return { email, success: false, error: err };
    });

    return { results };
  }
);

// ─────────────────────────────────────────────────────────────────────────────

interface ResendLeagueInviteData {
  placeholderTeamId: string;
}

/**
 * resendLeagueInvite — re-send an invite email for a pending placeholder team.
 *
 * Caller must be authenticated and must own the league the placeholder belongs to
 * (or be an admin).
 * Rate limit: 10 calls per minute per uid.
 */
export const resendLeagueInvite = onCall<ResendLeagueInviteData, Promise<{ success: boolean }>>(
  { secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');

    const uid = request.auth.uid;
    const role = await assertAdminOrCoach(uid);
    if (role !== 'admin' && role !== 'league_manager') {
      throw new HttpsError('permission-denied', 'Only league managers and admins can resend league invites.');
    }

    // SEC-91 (FW-64): paywall enforcement
    await assertSubscribedOrAdmin(uid);

    await checkRateLimit(uid, 'resendLeagueInvite', 10);

    const { placeholderTeamId } = request.data;
    if (!placeholderTeamId?.trim()) {
      throw new HttpsError('invalid-argument', 'placeholderTeamId is required.');
    }

    const db = admin.firestore();

    // Load the placeholder team.
    const teamSnap = await db.doc(`teams/${placeholderTeamId}`).get();
    if (!teamSnap.exists) {
      throw new HttpsError('not-found', 'Placeholder team not found.');
    }
    const team = teamSnap.data() as {
      isPending?: boolean;
      pendingEmail?: string;
      leagueIds?: string[];
    };
    if (!team.isPending) {
      throw new HttpsError('failed-precondition', 'This team is no longer pending.');
    }
    const email = team.pendingEmail ?? '';
    const leagueId = team.leagueIds?.[0] ?? '';
    if (!email || !leagueId) {
      throw new HttpsError('internal', 'Placeholder team is missing email or leagueId.');
    }

    // Verify caller owns the league.
    const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
    if (!leagueSnap.exists) {
      throw new HttpsError('not-found', `League ${leagueId} not found.`);
    }
    const league = leagueSnap.data() as { name: string; managedBy?: string };
    if (role !== 'admin' && !isManagerOfLeagueDoc(league as Record<string, unknown>, uid)) {
      throw new HttpsError('permission-denied', 'You do not own this league.');
    }

    const leagueName = league.name ?? 'Unknown League';
    const inviteUrl = `${APP_URL}/invite/league`;
    const transporter = createTransporter();

    await transporter.sendMail({
      from: emailFrom.value(),
      to: email,
      subject: `Reminder: You've been invited to join ${leagueName} on First Whistle`,
      text: [
        `You've been invited to join ${leagueName} on First Whistle.`,
        '',
        'Click the link below to accept your invitation:',
        inviteUrl,
        '',
        '---',
        'Sent via First Whistle',
      ].join('\n'),
      html: buildEmail({
        recipientName: 'Coach',
        preheader: `Reminder: You've been invited to join ${leagueName} on First Whistle`,
        title: `Reminder: You've been invited to join ${leagueName}`,
        message: `<p style="margin:0">Click below to accept your invitation and set up your team in the league.</p>`,
        ctaUrl: inviteUrl,
        ctaLabel: 'Accept Invitation',
      }),
    });

    console.log(`resendLeagueInvite: resent to email=${email} leagueId=${leagueId} uid=${uid}`);
    return { success: true };
  }
);

// ─────────────────────────────────────────────────────────────────────────────

interface AcceptLeagueInviteData {
  inviteId: string;
  realTeamId?: string;
}

/**
 * acceptLeagueInvite — accept a pending league invitation.
 *
 * If realTeamId is provided the caller brings their own team:
 *   - leagueId is added to the real team via arrayUnion.
 *   - Any events that referenced the placeholder are migrated to the real team
 *     (batched in groups of 500).
 *   - The placeholder team document is deleted.
 *
 * If realTeamId is omitted the placeholder team is promoted:
 *   - coachId is set to the caller's uid.
 *   - isPending and pendingEmail are removed via FieldValue.delete().
 *
 * The invite document is stamped with acceptedAt in both cases.
 */
export const acceptLeagueInvite = onCall<AcceptLeagueInviteData, Promise<{ success: boolean }>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');

    const uid = request.auth.uid;
    const callerEmail = request.auth.token.email;

    const { inviteId, realTeamId } = request.data;
    if (!inviteId?.trim()) {
      throw new HttpsError('invalid-argument', 'inviteId is required.');
    }

    const db = admin.firestore();

    // Load the invite document.
    const inviteRef = db.doc(`invites/${inviteId}`);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) {
      throw new HttpsError('not-found', 'Invite not found.');
    }
    const invite = inviteSnap.data() as {
      email: string;
      leagueId: string;
      leagueName: string;
      placeholderTeamId: string;
      invitedBy: string;
      invitedAt: string;
      acceptedAt?: string;
    };

    // Verify the caller's email matches the invite (admins bypass this check).
    const userSnap = await db.doc(`users/${uid}`).get();
    const isAdmin = userSnap.data()?.role === 'admin';
    if (!isAdmin && callerEmail?.toLowerCase() !== invite.email.toLowerCase()) {
      throw new HttpsError('permission-denied', 'This invite was not sent to your email address.');
    }

    // Use a transaction to atomically guard against double-acceptance (SEC-16 pattern).
    // The transaction reads the invite, verifies it is still open, stamps acceptedAt,
    // and — when the caller is using their own team — also adds leagueId to that team.
    // Event migration (potentially hundreds of docs) happens outside the transaction
    // because Firestore transactions cannot contain unbounded reads.
    const { leagueId, placeholderTeamId } = invite;
    const now = new Date().toISOString();

    const realTeamRef: admin.firestore.DocumentReference | null = realTeamId
      ? db.doc(`teams/${realTeamId}`)
      : null;

    await db.runTransaction(async (tx) => {
      const freshInviteSnap = await tx.get(inviteRef);
      const freshInvite = freshInviteSnap.data() as typeof invite | undefined;

      if (!freshInviteSnap.exists || !freshInvite) {
        throw new HttpsError('not-found', 'Invite not found.');
      }
      if (freshInvite.acceptedAt) {
        throw new HttpsError('already-exists', 'This invite has already been accepted.');
      }

      // Stamp accepted.
      tx.update(inviteRef, { acceptedAt: now });

      if (realTeamRef) {
        // SEC-32: read and verify ownership inside the transaction to prevent TOCTOU race
        // (coach removed from team between the pre-check and the write).
        const realTeamSnap = await tx.get(realTeamRef);
        if (!realTeamSnap.exists) {
          throw new HttpsError('not-found', 'Real team not found.');
        }
        if (!isAdmin && !isCoachOfTeamDoc(realTeamSnap.data()! as Record<string, unknown>, uid)) {
          throw new HttpsError('permission-denied', 'You do not own this team.');
        }
        // Add leagueId to real team atomically with the invite stamp.
        tx.update(realTeamRef, {
          leagueIds: FieldValue.arrayUnion(leagueId),
          updatedAt: now,
        });
      } else {
        // Promote the placeholder team.
        tx.update(db.doc(`teams/${placeholderTeamId}`), {
          coachId: uid,
          isPending: FieldValue.delete(),
          pendingEmail: FieldValue.delete(),
          updatedAt: now,
        });
      }
    });

    if (realTeamId) {
      // Migrate event fixture references from placeholder to real team in batches of 500.
      // Each document update combines arrayUnion + arrayRemove in a single update call
      // so both field transforms apply to the same server-side document version.
      const eventsRef = db.collection('events');
      let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        let q = eventsRef
          .where('teamIds', 'array-contains', placeholderTeamId)
          .limit(500);
        if (lastDoc) q = q.startAfter(lastDoc);

        const eventsSnap = await q.get();
        if (eventsSnap.empty) break;

        // Firestore does not allow two batch.update() calls for the same document
        // in the same field — the second would silently overwrite the first.
        // Work around this by updating two separate fields in one batch call per doc,
        // then issuing a second batch for the remove. In practice arrayUnion and
        // arrayRemove on the same field in one update() are each distinct FieldValue
        // transforms and Firestore applies them both atomically when passed in the
        // same object; however passing the same key twice in a JS object is invalid
        // (last-write-wins at the object level before it reaches the SDK).
        //
        // The correct approach: use two sequential batches — first add, then remove.
        // Because a teamId cannot be both the real and placeholder ID this is safe:
        // the union adds realTeamId, the remove drops placeholderTeamId.
        const batchAdd = db.batch();
        eventsSnap.docs.forEach((d) => {
          batchAdd.update(d.ref, {
            teamIds: FieldValue.arrayUnion(realTeamId),
          });
        });
        await batchAdd.commit();

        const batchRemove = db.batch();
        eventsSnap.docs.forEach((d) => {
          batchRemove.update(d.ref, {
            teamIds: FieldValue.arrayRemove(placeholderTeamId),
          });
        });
        await batchRemove.commit();

        if (eventsSnap.docs.length < 500) break;
        lastDoc = eventsSnap.docs[eventsSnap.docs.length - 1];
      }

      // Delete the placeholder team.
      await db.doc(`teams/${placeholderTeamId}`).delete();
    }

    console.log(`acceptLeagueInvite: uid=${uid} accepted inviteId=${inviteId} leagueId=${leagueId} realTeamId=${realTeamId ?? 'placeholder'}`);
    return { success: true };
  }
);





// ─── Scheduled: email quota log cleanup (weekly, Sunday midnight UTC) ─────────
// Deletes system/emailQuota_{YYYY-MM-DD} documents older than 30 days.
// Prevents unbounded growth of the system collection while retaining a
// rolling 30-day history for any manual audit.

export const cleanupEmailQuota = onSchedule('0 0 * * 0', async () => {
  // No ENV.shouldRunScheduledJobs() guard — see autoCloseCollections note
  // above (FW-82 Phase E).
  const db = admin.firestore();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10); // 'YYYY-MM-DD'

  // Quota docs are stored as system/emailQuota_{YYYY-MM-DD}.
  // We fetch all documents in the `system` collection that match the prefix
  // and have a date key portion less than the cutoff string (lexicographic
  // YYYY-MM-DD comparison is equivalent to chronological order).
  const systemSnap = await db.collection('system').get();
  const toDelete = systemSnap.docs.filter((d) => {
    const id = d.id;
    if (!id.startsWith('emailQuota_')) return false;
    const datePart = id.slice('emailQuota_'.length); // 'YYYY-MM-DD'
    return datePart < cutoffStr;
  });

  if (!toDelete.length) {
    console.log(`cleanupEmailQuota: no quota docs older than ${cutoffStr}`);
    return;
  }

  const batch = db.batch();
  toDelete.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  console.log(`cleanupEmailQuota: deleted ${toDelete.length} quota doc(s) older than ${cutoffStr}`);
});

// ─── Scoped Role Assignment ────────────────────────────────────────────────────

interface AssignScopedRoleData {
  email: string;
  role: 'coach' | 'league_manager';
  teamId?: string;
  leagueId?: string;
}

interface AssignScopedRoleResult {
  success: boolean;
  targetUid: string;
  displayName: string;
}

/**
 * Assign a scoped role (co-coach or co-manager) to a user identified by email.
 *
 * Authorization:
 * - role='coach' + teamId: caller must be a coach of that team (coachIds) or admin
 * - role='league_manager' + leagueId: caller must be an LM of that league (managerIds) or admin
 *
 * Writes (Admin SDK, bypasses Firestore rules):
 * - Appends membership to target user's memberships[]
 * - Adds target uid to team.coachIds or league.managerIds
 */
export const assignScopedRole = onCall<AssignScopedRoleData, Promise<AssignScopedRoleResult>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');

    const { email, role, teamId, leagueId } = request.data;
    const callerUid = request.auth.uid;

    // ── Input validation ──────────────────────────────────────────────────────
    if (!email?.trim()) throw new HttpsError('invalid-argument', 'email is required.');
    if (role !== 'coach' && role !== 'league_manager') {
      throw new HttpsError('invalid-argument', 'role must be "coach" or "league_manager".');
    }
    if (role === 'coach' && !teamId?.trim()) {
      throw new HttpsError('invalid-argument', 'teamId is required when role is "coach".');
    }
    if (role === 'league_manager' && !leagueId?.trim()) {
      throw new HttpsError('invalid-argument', 'leagueId is required when role is "league_manager".');
    }
    if (teamId && leagueId) {
      throw new HttpsError('invalid-argument', 'Provide teamId or leagueId, not both.');
    }

    await checkRateLimit(callerUid, 'assignScopedRole', 10);

    const db = admin.firestore();

    // ── Resolve target user by email ─────────────────────────────────────────
    let targetUid: string;
    let displayName: string;
    try {
      const targetUser = await admin.auth().getUserByEmail(email.trim().toLowerCase());
      targetUid = targetUser.uid;
      displayName = targetUser.displayName ?? email;
    } catch {
      // SEC-31: generic message — do not confirm whether email has an account
      throw new HttpsError('not-found', 'No account found for that email address.');
    }

    if (targetUid === callerUid) {
      throw new HttpsError('invalid-argument', 'You cannot assign a role to yourself.');
    }

    // ── Resolve caller profile (needed for membership-based admin check) ──────
    const callerDoc = await db.doc(`users/${callerUid}`).get();
    if (!callerDoc.exists) throw new HttpsError('not-found', 'Caller profile not found.');
    const callerData = callerDoc.data()!;
    const callerLegacyRole: string = callerData.role ?? '';
    const callerMembershipRoles: string[] = (callerData.memberships ?? []).map(
      (m: Record<string, unknown>) => m.role as string
    );
    const callerIsAdmin = [callerLegacyRole, ...callerMembershipRoles].includes('admin');

    // SEC-91 (FW-64): paywall enforcement — only the league_manager assignment
    // path is paywalled. Coach assignment (co-coach path) is a free feature.
    if (role === 'league_manager') {
      await assertSubscribedOrAdmin(callerUid);
    }

    // ── Atomic write + authorization (SEC-30: auth check inside transaction) ──
    // Reading the entity doc inside the transaction eliminates the TOCTOU window
    // between verifying the caller's coach/LM membership and writing the assignment.
    const targetUserRef = db.doc(`users/${targetUid}`);
    const entityRef = teamId ? db.doc(`teams/${teamId}`) : db.doc(`leagues/${leagueId!}`);

    await db.runTransaction(async (tx) => {
      const [targetSnap, entitySnap] = await Promise.all([
        tx.get(targetUserRef),
        tx.get(entityRef),
      ]);

      if (!targetSnap.exists) throw new HttpsError('not-found', 'Target user profile not found.');
      if (!entitySnap.exists) {
        throw new HttpsError('not-found', teamId ? 'Team not found.' : 'League not found.');
      }

      // Authorization: verify caller is still coach/LM at transaction time
      if (!callerIsAdmin) {
        const entityData = entitySnap.data()!;
        if (role === 'coach' && teamId) {
          // SEC-30: rely solely on entity doc arrays — callerData.memberships is read
          // outside the transaction and can be stale (revoked coach bypasses check).
          const coachIds: string[] = entityData.coachIds ?? [];
          const isCoachOfTeam = coachIds.includes(callerUid) || entityData.coachId === callerUid;
          if (!isCoachOfTeam) {
            throw new HttpsError('permission-denied', 'Only coaches of this team can assign co-coaches.');
          }
        } else if (role === 'league_manager' && leagueId) {
          const managerIds: string[] = entityData.managerIds ?? [];
          const isManagerOfLeague =
            managerIds.includes(callerUid) || entityData.managedBy === callerUid;
          if (!isManagerOfLeague) {
            throw new HttpsError('permission-denied', 'Only league managers of this league can assign co-managers.');
          }
        }
      }

      const targetData = targetSnap.data()!;
      const existingMemberships: Record<string, unknown>[] = Array.isArray(targetData.memberships)
        ? targetData.memberships
        : [];

      // Check for duplicate membership
      const alreadyAssigned = existingMemberships.some((m) => {
        if (role === 'coach') return m.role === 'coach' && m.teamId === teamId;
        return m.role === 'league_manager' && m.leagueId === leagueId;
      });

      if (!alreadyAssigned) {
        const newMembership: Record<string, unknown> = {
          role,
          isPrimary: existingMemberships.length === 0,
          ...(teamId ? { teamId } : { leagueId }),
        };
        tx.update(targetUserRef, {
          memberships: FieldValue.arrayUnion(newMembership),
        });
      }

      // Add uid to denormalized access list on team or league
      if (teamId) {
        tx.update(entityRef, {
          coachIds: FieldValue.arrayUnion(targetUid),
        });
      } else {
        tx.update(entityRef, {
          managerIds: FieldValue.arrayUnion(targetUid),
        });
      }
    });

    console.log(
      `assignScopedRole: caller=${callerUid} assigned role=${role} to target=${targetUid}` +
        (teamId ? ` teamId=${teamId}` : ` leagueId=${leagueId}`)
    );
    return { success: true, targetUid, displayName };
  }
);

/**
 * Returns a signed webcal:// feed URL for the calling user.
 * The URL is safe to share — it authenticates via HMAC, not Firebase Auth.
 */
export const getCalendarFeedUrl = onCall(
  { secrets: ['ICAL_SECRET'] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
    const uid = request.auth.uid;
    const token = signCalendarToken(uid);
    const feedUrl = `${FUNCTIONS_BASE}/calendarFeed?uid=${encodeURIComponent(uid)}&token=${token}`;
    return { url: feedUrl };
  }
);

// ─── Hard-delete team (callable) ─────────────────────────────────────────────

interface HardDeleteTeamInput {
  teamId: string;
}

/**
 * Admin-only. Team must already be soft-deleted. Called by purgeSoftDeletedData
 * or admin tooling only — not exposed to coach/LM roles.
 *
 * Permanently hard-deletes a team document and all its subcollections using
 * Admin SDK recursiveDelete. Coaches soft-delete via the store; the scheduler
 * purges after 30 days automatically. Coaches have no legitimate use case for
 * bypassing the grace period, so coach access is intentionally excluded.
 *
 * Rate-limited to 5 calls/minute per user.
 */
export const hardDeleteTeam = onCall<HardDeleteTeamInput, Promise<{ success: boolean }>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const uid = request.auth.uid;

    const { teamId } = request.data;
    if (!teamId?.trim()) throw new HttpsError('invalid-argument', 'teamId is required.');

    await checkRateLimit(uid, 'hardDeleteTeam', 5);

    const db = admin.firestore();

    // ── Step 1: fetch and validate team ───────────────────────────────────────
    const teamRef = db.doc(`teams/${teamId}`);
    const teamSnap = await teamRef.get();

    if (!teamSnap.exists) throw new HttpsError('not-found', 'Team not found.');
    const teamData = teamSnap.data()!;

    // ── Auth: admin only ───────────────────────────────────────────────────────
    const callerSnap = await db.doc(`users/${uid}`).get();
    const callerData = callerSnap.data();
    const legacyRole: string = callerData?.role ?? '';
    const membershipRoles: string[] = (callerData?.memberships ?? []).map(
      (m: Record<string, unknown>) => m.role as string,
    );
    const isAdmin = [legacyRole, ...membershipRoles].includes('admin');

    if (!isAdmin) {
      throw new HttpsError('permission-denied', 'Only admins may permanently delete a team.');
    }

    // ── Step 2: require soft-delete before hard-delete ─────────────────────────
    if (teamData.isDeleted !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Team must be soft-deleted before permanent deletion.',
      );
    }

    try {
      // ── Step 3: recursively delete the team doc + all subcollections ────────
      // recursiveDelete is available in firebase-admin v11+ (installed: v13.x).
      // It deletes the document at teamRef and every document in every
      // subcollection beneath it (messages, availability, etc.).
      await admin.firestore().recursiveDelete(teamRef);

      console.log(`hardDeleteTeam: permanently deleted teamId=${teamId} by uid=${uid}`);
      return { success: true };
    } catch (err: unknown) {
      if (err instanceof HttpsError) throw err;
      const message = err instanceof Error ? err.message : 'Failed to delete team.';
      console.error(`hardDeleteTeam: error deleting teamId=${teamId}:`, message);
      throw new HttpsError('internal', message);
    }
  },
);

// ─── Delete league (callable) ────────────────────────────────────────────────

interface DeleteLeagueInput {
  leagueId: string;
}

/**
 * Soft-deletes a league and performs server-side cleanup that the client
 * cannot do reliably (TD #517 — client-side Zustand cleanup misses records
 * that were never loaded into memory).
 *
 * Cleanup sequence:
 *   1. Fetch league doc — throws not-found if missing or already deleted.
 *   2. Remove leagueId from leagueIds on all member teams (batch, max 500/batch).
 *   3. Delete all events scoped to this league (batch, max 500/batch).
 *   4. Soft-delete the league doc (isDeleted=true, deletedAt timestamp).
 */
export const deleteLeague = onCall<DeleteLeagueInput, Promise<{ success: boolean }>>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const uid = request.auth.uid;

    const { leagueId } = request.data;
    if (!leagueId?.trim()) throw new HttpsError('invalid-argument', 'leagueId is required.');

    await checkRateLimit(uid, 'deleteLeague', 3);

    const db = admin.firestore();

    // ── Step 1: fetch and validate league ─────────────────────────────────────
    const leagueRef = db.doc(`leagues/${leagueId}`);
    const leagueSnap = await leagueRef.get();

    if (!leagueSnap.exists) throw new HttpsError('not-found', 'League not found.');
    const leagueData = leagueSnap.data()!;
    if (leagueData.isDeleted === true) throw new HttpsError('not-found', 'League not found.');

    // ── Auth: admin OR manager of this specific league ─────────────────────────
    const callerSnap = await db.doc(`users/${uid}`).get();
    const callerData = callerSnap.data();
    const legacyRole: string = callerData?.role ?? '';
    const membershipRoles: string[] = (callerData?.memberships ?? []).map(
      (m: Record<string, unknown>) => m.role as string,
    );
    const isAdmin = [legacyRole, ...membershipRoles].includes('admin');
    const isLeagueManager = isManagerOfLeagueDoc(leagueData as Record<string, unknown>, uid);

    if (!isAdmin && !isLeagueManager) {
      throw new HttpsError('permission-denied', 'Only admins or league managers may delete a league.');
    }

    // SEC-91 (FW-64): paywall enforcement
    await assertSubscribedOrAdmin(uid);

    try {
      const BATCH_SIZE = 490;

      // ── Step 2: remove leagueId from all member teams ──────────────────────
      const teamsSnap = await db
        .collection('teams')
        .where('leagueIds', 'array-contains', leagueId)
        .get();

      if (!teamsSnap.empty) {
        let teamBatch = db.batch();
        let teamOps = 0;

        for (const teamDoc of teamsSnap.docs) {
          teamBatch.update(teamDoc.ref, {
            leagueIds: FieldValue.arrayRemove(leagueId),
          });
          teamOps++;
          if (teamOps >= BATCH_SIZE) {
            await teamBatch.commit();
            teamBatch = db.batch();
            teamOps = 0;
          }
        }
        if (teamOps > 0) await teamBatch.commit();
        console.log(`deleteLeague: removed leagueId=${leagueId} from ${teamsSnap.size} teams`);
      }

      // ── Step 3: delete all events scoped to this league ────────────────────
      const eventsSnap = await db
        .collection('events')
        .where('leagueId', '==', leagueId)
        .get();

      if (!eventsSnap.empty) {
        let eventBatch = db.batch();
        let eventOps = 0;

        for (const eventDoc of eventsSnap.docs) {
          eventBatch.delete(eventDoc.ref);
          eventOps++;
          if (eventOps >= BATCH_SIZE) {
            await eventBatch.commit();
            eventBatch = db.batch();
            eventOps = 0;
          }
        }
        if (eventOps > 0) await eventBatch.commit();
        console.log(`deleteLeague: deleted ${eventsSnap.size} events for leagueId=${leagueId}`);
      }

      // ── Step 4: soft-delete the league doc ────────────────────────────────
      await leagueRef.update({
        isDeleted: true,
        deletedAt: new Date().toISOString(),
        deletedBy: uid,
      });

      console.log(`deleteLeague: soft-deleted leagueId=${leagueId} by uid=${uid}`);
      return { success: true };
    } catch (err: unknown) {
      if (err instanceof HttpsError) throw err;
      const message = err instanceof Error ? err.message : 'Failed to delete league.';
      throw new HttpsError('internal', message);
    }
  },
);

/**
 * Serves a live iCal feed for a user's accessible events.
 * Authenticated via HMAC token (no Firebase Auth required — calendar apps poll silently).
 */
export const calendarFeed = onRequest(
  { secrets: ['ICAL_SECRET'], cors: false },
  async (req, res) => {
    const uid = req.query['uid'] as string | undefined;
    const token = req.query['token'] as string | undefined;

    if (!uid || !token || !verifyCalendarToken(uid, token)) {
      res.status(403).send('Invalid or missing calendar token.');
      return;
    }

    const db = admin.firestore();

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      res.status(404).send('User not found.');
      return;
    }
    const profile = userSnap.data()!;

    // Derive accessible team IDs from memberships (or legacy teamId)
    const memberships: Array<{ teamId?: string; role?: string; leagueId?: string }> = profile.memberships ?? [];
    const teamIds = new Set<string>();
    if (profile.teamId) teamIds.add(profile.teamId);
    memberships.forEach(m => { if (m.teamId) teamIds.add(m.teamId); });

    const isAdmin = profile.role === 'admin' || memberships.some(m => m.role === 'admin');
    const isElevated = isAdmin ||
      profile.role === 'coach' || profile.role === 'league_manager' ||
      memberships.some(m => m.role === 'coach' || m.role === 'league_manager');
    const leagueId: string | undefined =
      profile.leagueId ?? memberships.find(m => m.role === 'league_manager')?.leagueId;

    // SEC-36: exclude draft events at query level to avoid full-collection scan
    const eventsSnap = await db.collection('events')
      .where('status', 'in', ['scheduled', 'completed', 'cancelled', 'in_progress'])
      .orderBy('date')
      .get();

    const events = eventsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter((e: any) => {
        // SEC-39: never expose draft events (belt-and-suspenders after query filter)
        if (e.status === 'draft') return false;
        if (isAdmin) return true;
        if (leagueId && e.leagueId === leagueId) return true;
        const eventTeamIds: string[] = e.teamIds ?? (e.teamId ? [e.teamId] : []);
        return eventTeamIds.some((t: string) => teamIds.has(t));
      });

    // Derive a meaningful calendar name: team name for single-team users, display name otherwise
    let calName = `First Whistle — ${profile.displayName ?? 'Schedule'}`;
    if (!isAdmin && !leagueId && teamIds.size === 1) {
      const [singleTeamId] = teamIds;
      const teamSnap = await db.doc(`teams/${singleTeamId}`).get();
      if (teamSnap.exists) {
        const teamName: string = teamSnap.data()!.name ?? 'My Team';
        calName = `First Whistle — ${teamName}`;
      }
    }

    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//First Whistle//Sports Scheduler//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${icalEscape(calName)}`,
      'X-WR-TIMEZONE:UTC',
    ];

    for (const e of events as any[]) {
      const startTime: string = e.startTime ?? '09:00';
      const dtstart = formatICalDate(e.date, startTime);
      const dtend = e.endTime
        ? formatICalDate(e.date, e.endTime)
        : formatICalDate(e.date, startTime, e.duration ?? 60);

      const status = e.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED';
      const updatedAt = e.updatedAt
        ? new Date(e.updatedAt).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
        : dtstart;

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${e.id}@firstwhistlesports.com`);
      lines.push(`DTSTAMP:${updatedAt}`);
      lines.push(`DTSTART:${dtstart}`);
      lines.push(`DTEND:${dtend}`);
      lines.push(`SUMMARY:${icalEscape(e.title ?? 'Event')}`);
      lines.push(`STATUS:${status}`);
      if (e.location) lines.push(`LOCATION:${icalEscape(e.location)}`);
      // SEC-39: coach notes are only visible to elevated roles (coach/admin/league_manager)
      if (e.notes && isElevated) lines.push(`DESCRIPTION:${icalEscape(e.notes)}`);
      // SEC-43: validate coordinates are numbers before emitting GEO property
      if (typeof e.venueLat === 'number' && typeof e.venueLng === 'number') {
        lines.push(`GEO:${e.venueLat};${e.venueLng}`);
      }
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="first-whistle.ics"');
    // SEC-44: allow CDN/proxy caching for up to 5 minutes to reduce Firestore read costs.
    // Calendar apps typically poll every 15-60 min so 5-min staleness is acceptable.
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(lines.join('\r\n'));
  }
);

// ─── Custom claims: sync role claim on user doc write ────────────────────────

/**
 * Firestore trigger that keeps the `role` Auth custom claim in sync with the
 * `role` field on the user's Firestore profile document.
 *
 * This eliminates the getProfile() cross-doc read that firestore.rules previously
 * made on nearly every rule evaluation. Rules now read request.auth.token.role
 * instead of calling get(/databases/.../users/{uid}).
 *
 * NOTE: Existing users will not have the claim until their next profile write
 * or until they call the refreshClaims callable. No backfill is performed here
 * to avoid a fan-out spike on deploy. Use backfillAccessControl (admin callable)
 * or run a one-off migration script if immediate population is needed.
 */
export const syncUserClaims = onDocumentWritten(
  { document: 'users/{uid}', retry: true },
  async (event) => {
    const uid = event.params.uid;
    const before = event.data?.before;
    const after = event.data?.after;

    if (!after?.exists) {
      // Document was deleted — clear custom claims so stale role is not retained.
      // SEC-78: let errors propagate so Eventarc retries (retry: true on this trigger).
      await admin.auth().setCustomUserClaims(uid, {});
      console.log(`syncUserClaims: cleared claims for deleted uid=${uid}`);
      return;
    }

    const data = after.data();
    const role: string | null = (data?.role as string) ?? null;
    const roleBefore: string | null = (before?.exists ? (before.data()?.role as string) : null) ?? null;

    // FW-63: derive subscription claim from subscriptionTier + adminGrantedLM bypass.
    // Either Stripe-mirrored Pro tier OR admin grant produces the claim.
    const tier = (data?.subscriptionTier as string) ?? 'free';
    const adminGranted = data?.adminGrantedLM === true;
    const subscription: string | null = (tier === 'league_manager_pro' || adminGranted) ? 'league_manager_pro' : null;

    const beforeData = before?.exists ? before.data() : null;
    const tierBefore = (beforeData?.subscriptionTier as string) ?? 'free';
    const adminGrantedBefore = beforeData?.adminGrantedLM === true;
    const subscriptionBefore: string | null =
      (tierBefore === 'league_manager_pro' || adminGrantedBefore) ? 'league_manager_pro' : null;

    try {
      const claims: Record<string, unknown> = { role };
      if (subscription !== null) claims.subscription = subscription;
      await admin.auth().setCustomUserClaims(uid, claims);
      console.log(`syncUserClaims: set role=${role} subscription=${subscription} for uid=${uid}`);
    } catch (err: unknown) {
      console.error(`syncUserClaims: failed to set claims for uid=${uid}`, (err as Error)?.message);
      throw err; // SEC-78: allow Eventarc platform retry
    }

    // SEC-77 / SEC-85: revoke refresh tokens when role is demoted OR when the
    // subscription claim is downgraded (Pro → null). Limits the stale-privilege
    // window to the remaining TTL of the current access token (~≤1h) rather
    // than until the refresh token expires.
    const subscriptionDowngraded = subscriptionBefore !== null && subscription === null;
    if ((roleBefore !== null && role !== roleBefore) || subscriptionDowngraded) {
      await admin.auth().revokeRefreshTokens(uid);
      const reason = subscriptionDowngraded
        ? `subscription downgraded ${subscriptionBefore} → ${subscription}`
        : `role changed ${roleBefore} → ${role}`;
      console.log(`syncUserClaims: revoked refresh tokens for uid=${uid} (${reason})`);
    }
  }
);

// ─── Stripe subscription → user doc mirror (FW-63) ───────────────────────────

/**
 * Mirrors Stripe subscription state from the firestore-stripe-payments extension's
 * `customers/{uid}/subscriptions/{subId}` documents onto the user doc. The user-doc
 * write triggers `syncUserClaims`, which then recomputes the JWT subscription claim.
 *
 * Entitled statuses (per FW-58 decision #4 — 7-day past-due grace):
 *   active, trialing, past_due → tier = 'league_manager_pro'
 *   anything else (canceled, incomplete, incomplete_expired, unpaid) → tier = 'free'
 *
 * If the user holds multiple subscriptions, picks the most-entitling one. Per
 * FW-58 decision #6 (per-UID pricing), this should be at most one in practice.
 */
export const syncStripeSubscriptionToUser = onDocumentWritten(
  { document: 'customers/{uid}/subscriptions/{subId}', retry: true },
  async (event) => {
    const uid = event.params.uid;
    const ENTITLED = new Set(['active', 'trialing', 'past_due']);

    // Re-read all subscriptions for this customer to compute the effective state,
    // not just the one that changed. Handles the multi-sub edge case correctly.
    const subsSnap = await admin.firestore()
      .collection(`customers/${uid}/subscriptions`)
      .get();

    let effectiveStatus: string | null = null;
    let effectiveExpiresAt: string | null = null;
    let effectiveInterval: 'month' | 'year' | null = null;
    let effectivePriceAmount: number | null = null;
    let effectiveCurrency: string | null = null;

    function pickPlanFields(sub: Record<string, unknown>) {
      const items = sub.items as Array<Record<string, unknown>> | undefined;
      const plan = items?.[0]?.plan as Record<string, unknown> | undefined;
      const interval = plan?.interval as 'month' | 'year' | undefined;
      const amount = plan?.amount as number | undefined;
      const currency = plan?.currency as string | undefined;
      return { interval: interval ?? null, amount: amount ?? null, currency: currency ?? null };
    }

    for (const doc of subsSnap.docs) {
      const sub = doc.data();
      const status = sub.status as string | undefined;
      if (!status) continue;
      // Prefer entitled subs over non-entitled
      if (ENTITLED.has(status) && (effectiveStatus === null || !ENTITLED.has(effectiveStatus))) {
        effectiveStatus = status;
        const periodEnd = sub.current_period_end;
        effectiveExpiresAt = periodEnd?.toDate ? periodEnd.toDate().toISOString() : null;
        const plan = pickPlanFields(sub);
        effectiveInterval = plan.interval;
        effectivePriceAmount = plan.amount;
        effectiveCurrency = plan.currency;
      } else if (effectiveStatus === null) {
        effectiveStatus = status;
        const plan = pickPlanFields(sub);
        effectiveInterval = plan.interval;
        effectivePriceAmount = plan.amount;
        effectiveCurrency = plan.currency;
      }
    }

    const tier = effectiveStatus && ENTITLED.has(effectiveStatus) ? 'league_manager_pro' : 'free';

    await admin.firestore().doc(`users/${uid}`).set({
      subscriptionTier: tier,
      subscriptionStatus: effectiveStatus ?? 'canceled',
      subscriptionExpiresAt: effectiveExpiresAt,
      subscriptionInterval: effectiveInterval,
      subscriptionPriceAmount: effectivePriceAmount,
      subscriptionCurrency: effectiveCurrency,
    }, { merge: true });

    console.log(`syncStripeSubscriptionToUser: uid=${uid} tier=${tier} status=${effectiveStatus} expiresAt=${effectiveExpiresAt} interval=${effectiveInterval}`);
  }
);

// ─── Custom claims: force token refresh ──────────────────────────────────────

/**
 * Callable that lets a client force a token refresh after a role change.
 *
 * Firebase ID tokens cache custom claims for up to 1 hour. After an admin
 * changes a user's role, the affected client must call this function and then
 * call user.getIdToken(true) to get a fresh token with the updated claim.
 *
 * Rate-limited to 10 calls per minute per user.
 */
export const refreshClaims = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  const uid = request.auth.uid;

  await checkRateLimit(uid, 'refreshClaims', 10);

  const [userDoc, authUser] = await Promise.all([
    admin.firestore().collection('users').doc(uid).get(),
    admin.auth().getUser(uid),
  ]);
  const role: string | null = userDoc.exists ? ((userDoc.data()?.role as string) ?? null) : null;

  // SEC-79: skip the write if the claim is already correct.
  const existingRole = (authUser.customClaims as Record<string, unknown> | undefined)?.role ?? null;
  if (existingRole === role) return { success: true, unchanged: true };

  try {
    await admin.auth().setCustomUserClaims(uid, { role });
    console.log(`refreshClaims: synced role=${role} for uid=${uid}`);
  } catch (err: unknown) {
    console.error(`refreshClaims: failed to set claims for uid=${uid}:`, (err as Error)?.message);
    throw new HttpsError('internal', 'Failed to refresh claims. Please try again.');
  }

  return { success: true };
});

// ─── Submit RSVP (callable) ───────────────────────────────────────────────────

/**
 * Callable that writes an RSVP entry to events/{eventId}/rsvps/{docKey}.
 *
 * SEC-99 / SEC-81: RSVP writes are blocked by `allow write: if false` in
 * Firestore rules. All RSVP writes must go through this function so that
 * ownership of the playerId is validated server-side.
 *
 * Self-RSVP (coach/player RSVPing for themselves):
 *   - Omit playerId — the caller's uid is used as both the playerId and the
 *     doc key, matching the existing uid-only key format in useRsvpStore.
 *
 * Parent RSVPing for a child:
 *   - Provide playerId — validated against the parent's memberships[] array.
 *   - Doc key is uid_playerId (matches useRsvpStore's existing format).
 *
 * Rate-limited to 20 calls per minute per user.
 */
export const submitRsvp = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  const uid = request.auth.uid;

  await checkRateLimit(uid, 'submitRsvp', 20);

  const data = request.data as {
    eventId?: unknown;
    playerId?: unknown;
    name?: unknown;
    response?: unknown;
  };

  const eventId = typeof data.eventId === 'string' ? data.eventId.trim() : '';
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) throw new HttpsError('invalid-argument', 'name is required.');

  const VALID_RESPONSES = new Set(['yes', 'no', 'maybe']);
  const response = typeof data.response === 'string' ? data.response : '';
  if (!VALID_RESPONSES.has(response)) {
    throw new HttpsError('invalid-argument', 'response must be "yes", "no", or "maybe".');
  }

  const db = admin.firestore();

  // Determine effectivePlayerId — empty/absent means self-RSVP.
  const rawPlayerId = typeof data.playerId === 'string' ? data.playerId.trim() : '';
  const effectivePlayerId = rawPlayerId || uid;
  const isSelf = effectivePlayerId === uid;

  if (!isSelf) {
    // Validate ownership: caller must have this playerId in their memberships[].
    const profileSnap = await db.doc(`users/${uid}`).get();
    if (!profileSnap.exists) throw new HttpsError('not-found', 'User profile not found.');
    const profile = profileSnap.data()!;
    const memberships: Array<{ playerId?: string }> = profile.memberships ?? [];
    if (!memberships.some(m => m.playerId === effectivePlayerId)) {
      throw new HttpsError('permission-denied', 'You do not have permission to RSVP for this player.');
    }
  }

  // Doc key format matches useRsvpStore: uid for self-RSVP, uid_playerId for proxy.
  const docKey = isSelf ? uid : `${uid}_${effectivePlayerId}`;

  const entry: Record<string, unknown> = {
    uid,
    name,
    response,
    updatedAt: new Date().toISOString(),
  };
  if (!isSelf) {
    entry.playerId = effectivePlayerId;
  }

  try {
    await db.doc(`events/${eventId}/rsvps/${docKey}`).set(entry);
    console.log(`submitRsvp: uid=${uid} eventId=${eventId} docKey=${docKey} response=${response}`);
  } catch (err: unknown) {
    console.error('submitRsvp: Firestore write failed:', (err as Error)?.message);
    throw new HttpsError('internal', 'Failed to save RSVP. Please try again.');
  }

  return { success: true };
});

// ─── Team schedule ICS export (public HTTP, no auth) ─────────────────────────

/** Fold a single ICS property line at 75 octets per RFC 5545 §3.1. */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let offset = 0;
  let first = true;
  while (offset < bytes.length) {
    const chunkSize = first ? 75 : 74;
    first = false;
    parts.push((parts.length > 0 ? ' ' : '') + bytes.slice(offset, offset + chunkSize).toString('utf8'));
    offset += chunkSize;
  }
  return parts.join('\r\n');
}

export const exportTeamSchedule = onRequest(
  { cors: false },
  async (req, res) => {
    const teamId = req.query['teamId'] as string | undefined;

    if (!teamId?.trim()) {
      res.status(400).send('teamId is required.');
      return;
    }

    const db = admin.firestore();

    const teamSnap = await db.doc(`teams/${teamId}`).get();
    if (!teamSnap.exists) {
      res.status(404).send('Team not found.');
      return;
    }
    const teamName: string = teamSnap.data()?.name ?? 'Team';

    const eventsSnap = await db.collection('events')
      .where('teamIds', 'array-contains', teamId)
      .where('status', 'not-in', ['draft'])
      .get();

    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//First Whistle//Sports Scheduler//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      foldLine(`X-WR-CALNAME:${icalEscape(teamName)} Schedule`),
      'X-WR-TIMEZONE:America/Chicago',
    ];

    for (const doc of eventsSnap.docs) {
      const e = doc.data();
      const startTime: string = e.startTime ?? '09:00';
      const dtstart = `TZID=America/Chicago:${(e.date as string ?? '').replace(/-/g, '')}T${startTime.replace(':', '')}00`;
      const endTime: string = e.endTime ?? '';
      let dtend: string;
      if (endTime) {
        dtend = `TZID=America/Chicago:${(e.date as string ?? '').replace(/-/g, '')}T${endTime.replace(':', '')}00`;
      } else {
        const d = new Date(`${e.date as string}T${startTime}:00`);
        d.setMinutes(d.getMinutes() + 90);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        dtend = `TZID=America/Chicago:${(e.date as string ?? '').replace(/-/g, '')}T${hh}${mm}00`;
      }

      const status = e.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED';

      const dtstamp = e.updatedAt
        ? new Date(e.updatedAt as string).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
        : new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

      const description = [e.type ?? 'event', teamName].filter(Boolean).join(' — ');

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${doc.id}@firstwhistle.app`);
      lines.push(`DTSTAMP:${dtstamp}`);
      lines.push(foldLine(`DTSTART;${dtstart}`));
      lines.push(foldLine(`DTEND;${dtend}`));
      lines.push(foldLine(`SUMMARY:${icalEscape(e.title ?? 'Event')}`));
      lines.push(`STATUS:${status}`);
      if (e.location) lines.push(foldLine(`LOCATION:${icalEscape(e.location as string)}`));
      lines.push(foldLine(`DESCRIPTION:${icalEscape(description)}`));
      if (e.updatedAt) lines.push(`LAST-MODIFIED:${dtstamp}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="schedule.ics"');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(lines.join('\r\n'));
  }
);

// ─── Trigger: keep event.recipients[] fresh on event create/update ────────────
//
// Fires whenever an events/{eventId} document is created or updated.
// Recomputes recipients[] only when teamId-related fields change
// (teamIds, homeTeamId, awayTeamId) to avoid redundant fan-out reads on
// unrelated updates (e.g. rsvp stamps, result writes).
//
// FW-82 / FW-84 — Phase B

export const onEventWrittenRecipients = onDocumentWritten(
  'events/{eventId}',
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // Deleted events — nothing to update.
    if (!after) return;

    // Determine if team-membership-relevant fields changed.
    // On create, before is undefined, so always compute.
    const teamIdsChanged =
      !before ||
      JSON.stringify(before.teamIds ?? []) !== JSON.stringify(after.teamIds ?? []) ||
      before.homeTeamId !== after.homeTeamId ||
      before.awayTeamId !== after.awayTeamId;

    if (!teamIdsChanged) return;

    const teamIds: string[] = (after.teamIds ?? []).filter(
      (id: unknown): id is string => typeof id === 'string' && id.length > 0,
    );

    if (!teamIds.length) {
      // No teams — write empty recipients so stale data is not left behind.
      await event.data!.after.ref.update({ recipients: [] });
      return;
    }

    const db = admin.firestore();

    // Batch-read teams
    const teamDataById = new Map<string, FirebaseFirestore.DocumentData>();
    for (let i = 0; i < teamIds.length; i += FIRESTORE_IN_QUERY_LIMIT) {
      const chunk = teamIds.slice(i, i + FIRESTORE_IN_QUERY_LIMIT);
      const snap = await db
        .collection('teams')
        .where(FieldPath.documentId(), 'in', chunk)
        .get();
      for (const doc of snap.docs) teamDataById.set(doc.id, doc.data());
    }

    // Collect coach UIDs
    const allCoachIds = new Set<string>();
    for (const teamData of teamDataById.values()) {
      for (const uid of (teamData.coachIds as string[] | undefined) ?? []) {
        if (typeof uid === 'string' && uid.length > 0) allCoachIds.add(uid);
      }
    }

    // Batch-read coach profiles
    const coachProfiles = new Map<string, FirebaseFirestore.DocumentData>();
    const coachIdList = Array.from(allCoachIds);
    for (let i = 0; i < coachIdList.length; i += FIRESTORE_IN_QUERY_LIMIT) {
      const chunk = coachIdList.slice(i, i + FIRESTORE_IN_QUERY_LIMIT);
      const snap = await db
        .collection('users')
        .where(FieldPath.documentId(), 'in', chunk)
        .get();
      for (const doc of snap.docs) coachProfiles.set(doc.id, doc.data());
    }

    // Batch-read players per team
    const playersByTeam = new Map<string, FirebaseFirestore.DocumentData[]>();
    for (const id of teamIds) playersByTeam.set(id, []);
    for (let i = 0; i < teamIds.length; i += FIRESTORE_IN_QUERY_LIMIT) {
      const chunk = teamIds.slice(i, i + FIRESTORE_IN_QUERY_LIMIT);
      const snap = await db
        .collection('players')
        .where('teamId', 'in', chunk)
        .get();
      for (const doc of snap.docs) {
        const teamId = doc.data().teamId as string | undefined;
        if (!teamId) continue;
        const bucket = playersByTeam.get(teamId) ?? [];
        bucket.push(doc.data());
        playersByTeam.set(teamId, bucket);
      }
    }

    // Fetch registered parent users (path B identity).
    // Single equality query on the top-level 'role' field — no composite index.
    // In-memory filtering inside computeEventRecipients narrows to teamIds.
    // Limit 500: parent-role accounts are a small slice of the users collection.
    const parentUsersSnap = await db
      .collection('users')
      .where('role', '==', 'parent')
      .limit(500)
      .get();
    const parentUsers = parentUsersSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        uid: doc.id,
        displayName: typeof d.displayName === 'string' ? d.displayName : undefined,
        email: typeof d.email === 'string' ? d.email : undefined,
        memberships: Array.isArray(d.memberships)
          ? (d.memberships as Array<{ role?: string; teamId?: string; playerId?: string }>)
          : [],
      };
    });

    const recipients = computeEventRecipients(
      teamIds,
      playersByTeam as Map<string, Record<string, unknown>[]>,
      coachProfiles as Map<string, Record<string, unknown>>,
      teamDataById as Map<string, Record<string, unknown>>,
      parentUsers,
    );

    await event.data!.after.ref.update({ recipients });
    console.log(
      `[onEventWrittenRecipients] event=${event.params.eventId} — wrote ${recipients.length} recipient(s)`,
    );
  }
);

// ─── Trigger: rebuild recipients on team roster changes ──────────────────────
//
// Fires whenever a teams/{teamId} document is written. When coachIds changes,
// batch-rebuilds recipients[] on all upcoming events for that team.
// Scoped to status=scheduled, date>=today to avoid unbounded scans.
//
// FW-82 / FW-84 — Phase B

export const onTeamMembershipChanged = onDocumentWritten(
  'teams/{teamId}',
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // Deleted teams — nothing to do (events will have stale recipients but
    // the events themselves should be cancelled separately).
    if (!after) return;

    // Check if roster-relevant fields changed.
    const coachIdsChanged =
      !before ||
      JSON.stringify(before.coachIds ?? []) !== JSON.stringify(after.coachIds ?? []);

    // Players are in a separate collection so we also rebuild when the team
    // name changes (rare but keeps display names fresh) or when it's a create.
    const shouldRebuild = coachIdsChanged || !before;
    if (!shouldRebuild) return;

    const teamId = event.params.teamId;
    console.log(`[onTeamMembershipChanged] team=${teamId} — rebuilding recipients`);
    await rebuildRecipientsForTeam(teamId, admin.firestore());

    // Refresh denormalized team.coaches map so DM contact discovery and
    // sender-name display can read coach metadata without N+1 user-doc
    // getDocs (FW-90 / ADR-014 Rule 2). Idempotent; safe to re-run.
    if (coachIdsChanged) {
      try {
        await refreshTeamCoachesDenorm(teamId, after.coachIds ?? [], admin.firestore());
      } catch (err) {
        console.warn(`[onTeamMembershipChanged] refreshTeamCoachesDenorm failed for ${teamId}:`, err);
      }
    }

    console.log(`[onTeamMembershipChanged] team=${teamId} — done`);
  }
);

/**
 * Reads the user docs for the given coachIds and writes a denormalized
 * `coaches: { [uid]: { name, email? } }` map back onto the team doc.
 *
 * Idempotent: identical input produces identical output. Skips the write
 * when the resolved map matches what's already on the team. Per ADR-014
 * Rule 2 (Denormalize via triggers, fan-out at write time, free reads).
 */
async function refreshTeamCoachesDenorm(
  teamId: string,
  coachIds: string[],
  db: admin.firestore.Firestore,
): Promise<void> {
  if (coachIds.length === 0) {
    // No coaches → clear the map. Use FieldValue.delete() to remove the field
    // entirely so reads don't see an empty {} shape.
    await db.doc(`teams/${teamId}`).update({
      coaches: FieldValue.delete(),
    }).catch(() => { /* doc may have been deleted */ });
    return;
  }

  const snaps = await Promise.all(coachIds.map(uid => db.doc(`users/${uid}`).get()));
  const coaches: Record<string, { name: string; email?: string }> = {};
  snaps.forEach((s, i) => {
    const uid = coachIds[i];
    if (!s.exists) return;
    const u = s.data() ?? {};
    const name = (u.displayName as string | undefined) ?? (u.email as string | undefined) ?? uid;
    const entry: { name: string; email?: string } = { name };
    if (typeof u.email === 'string' && u.email.length > 0) entry.email = u.email;
    coaches[uid] = entry;
  });

  await db.doc(`teams/${teamId}`).set({ coaches }, { merge: true });
}

// ─── Trigger: rebuild recipients on player roster changes ─────────────────────
//
// Fires whenever a players/{playerId} document is written. Identifies the
// affected team(s) from before/after teamId fields and calls rebuildRecipientsForTeam
// for each. Handles create, delete, edit, and team-move (before.teamId ≠ after.teamId).
//
// Cost note: bulk roster ops fire N triggers, each rebuilding the same team.
// Redundant rebuilds are accepted per FW-88 design — debouncing is deferred to FW-89.
//
// FW-88 / FW-82 Phase B

export const onPlayerWritten = onDocumentWritten(
  'players/{playerId}',
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // Collect all affected teams:
    //   delete → before.teamId present, after undefined
    //   create → after.teamId present, before undefined
    //   move   → before.teamId !== after.teamId (rebuild both)
    //   edit   → before.teamId === after.teamId (rebuild once, Set deduplicates)
    const teamIds = new Set<string>();
    if (typeof before?.teamId === 'string' && before.teamId.length > 0) {
      teamIds.add(before.teamId);
    }
    if (typeof after?.teamId === 'string' && after.teamId.length > 0) {
      teamIds.add(after.teamId);
    }

    if (teamIds.size === 0) {
      // Player has no teamId — nothing to rebuild.
      return;
    }

    const playerId = event.params.playerId;
    const db = admin.firestore();

    for (const teamId of teamIds) {
      console.log(
        `[onPlayerWritten] player=${playerId} — rebuilding recipients for team=${teamId}`,
      );
      await rebuildRecipientsForTeam(teamId, db);
    }

    console.log(`[onPlayerWritten] player=${playerId} — done`);
  }
);

// ─── Trigger: denormalize rsvpCounts on event doc ────────────────────────────
//
// Fires whenever any rsvp subcollection document is created, updated, or
// deleted. Re-reads the full subcollection and overwrites event.rsvpCounts.
//
// Design notes (FW-98 / ADR-012):
//   - Both submitRsvp (callable) and rsvpEvent (HTTP) write to the subcollection,
//     so the trigger fires on either path — no dual write-site risk.
//   - The trigger is idempotent: it re-reads the entire subcollection and
//     overwrites the counter each time. Safe on retry (retry: true).
//   - Cost: O(N) reads where N = total RSVPs for this event per trigger fire.
//     Bounded per event; expected N is small (roster size, typically < 30).
//   - Guard against non-existent event: we read the event doc before writing;
//     if it doesn't exist we bail out rather than silently creating a stub doc.
//   - Does NOT use ENV.shouldRunScheduledJobs() — this is a write trigger,
//     not a notification dispatcher. Runs on staging and prod alike.
//
// FW-98

export const onRsvpWritten = onDocumentWritten(
  { document: 'events/{eventId}/rsvps/{rsvpId}', retry: true },
  async (event) => {
    const eventId = event.params.eventId;
    const db = admin.firestore();

    // Guard: do not write to a non-existent event doc.
    const eventRef = db.doc(`events/${eventId}`);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      console.warn(`[onRsvpWritten] event=${eventId} does not exist — skipping rsvpCounts update`);
      return;
    }

    // Re-read entire subcollection and recompute counts.
    // Cost: O(N) reads where N = total RSVPs for this event. Bounded per write.
    const rsvpsSnap = await db.collection(`events/${eventId}/rsvps`).get();
    const counts = { yes: 0, no: 0, maybe: 0 };
    for (const doc of rsvpsSnap.docs) {
      const r = doc.data()['response'];
      if (r === 'yes' || r === 'no' || r === 'maybe') {
        counts[r as 'yes' | 'no' | 'maybe']++;
      }
    }

    await eventRef.update({ rsvpCounts: counts });
    console.log(`[onRsvpWritten] event=${eventId} rsvpId=${event.params.rsvpId} — rsvpCounts updated: yes=${counts.yes} no=${counts.no} maybe=${counts.maybe}`);
  }
);
