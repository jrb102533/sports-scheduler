import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import * as crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';

const APP_URL = 'https://first-whistle-e76f4.web.app';
const FUNCTIONS_BASE = 'https://us-central1-first-whistle-e76f4.cloudfunctions.net';

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
const anthropicKey = defineSecret('ANTHROPIC_API_KEY');

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
async function assertAdminOrCoach(uid: string): Promise<string> {
  const userDoc = await admin.firestore().doc(`users/${uid}`).get();
  const data = userDoc.data();
  const legacyRole: string = data?.role ?? '';
  const membershipRoles: string[] = (data?.memberships ?? []).map((m: Record<string, unknown>) => m.role as string);
  const allRoles = new Set([legacyRole, ...membershipRoles]);
  // Return the highest-privilege role so callers can enforce further restrictions.
  for (const r of ['admin', 'coach', 'league_manager'] as const) {
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
    tx.update(ref, { count: admin.firestore.FieldValue.increment(1) });
  });
}

// ─── Admin: create user with temporary password ───────────────────────────────

interface CreateUserByAdminData {
  email: string;
  displayName: string;
  role: string;
  tempPassword: string;
  teamId?: string;
  leagueId?: string;
}

export const createUserByAdmin = onCall<CreateUserByAdminData>(
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const callerRole = await assertAdminOrCoach(request.auth.uid);

    const { email, displayName, role, tempPassword, teamId, leagueId } = request.data;
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
        },
      ],
    };
    if (teamId) profile.teamId = teamId;
    if (leagueId) profile.leagueId = leagueId;

    await admin.firestore().doc(`users/${uid}`).set(profile);
    console.log(`createUserByAdmin: created uid=${uid}, role=${role}`);
    return { uid };
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
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
              <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:10px;padding:16px 20px;margin-bottom:20px">
                <p style="color:white;font-weight:700;font-size:16px;margin:0">First Whistle</p>
                ${teamName ? `<p style="color:rgba(255,255,255,0.8);font-size:12px;margin:2px 0 0">${esc(teamName)}</p>` : ''}
              </div>
              ${senderLine}
              ${recipientLine}
              <p style="color:#111827;white-space:pre-wrap;line-height:1.6">${escapedMessage}</p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
              <p style="color:#9ca3af;font-size:12px;text-align:center">Sent via First Whistle</p>
            </div>
          `,
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

interface SendInviteData {
  to: string;
  playerName: string;
  teamName: string;
  playerId: string;
  teamId: string;
}

export const sendInvite = onCall<SendInviteData>(
  { secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in.');
    await assertAdminOrCoach(request.auth.uid);
    await checkRateLimit(request.auth.uid, 'sendInvite', 20);

    const { to, playerName, teamName, playerId, teamId } = request.data;
    if (!to?.trim()) throw new HttpsError('invalid-argument', 'Email address is required.');

    const appUrl = 'https://first-whistle-e76f4.web.app';

    // Store invite so auto-link can find it on signup/login
    await admin.firestore().doc(`invites/${to.toLowerCase().trim()}`).set({
      playerId,
      teamId,
      playerName,
      teamName,
      invitedAt: new Date().toISOString(),
    });

    const transporter = createTransporter();
    await transporter.sendMail({
      from: emailFrom.value(),
      to: `${playerName} <${to.trim()}>`,
      subject: `You've been added to ${teamName} on First Whistle`,
      text: `Hi ${playerName},\n\nYou've been added to ${teamName} on First Whistle.\n\nSign up or log in to view your schedule, track attendance, and stay connected with your team:\n${appUrl}\n\nSee you on the field!`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
          <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:12px;padding:24px;margin-bottom:24px;text-align:center">
            <p style="color:white;font-weight:700;font-size:22px;margin:0">First Whistle</p>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px">Game day starts here.</p>
          </div>
          <p style="color:#111827;font-size:15px">Hi ${esc(playerName)},</p>
          <p style="color:#374151">You've been added to <strong>${esc(teamName)}</strong> on First Whistle.</p>
          <p style="color:#374151">Sign up or log in to view your schedule, track attendance, and stay connected with your team.</p>
          <div style="text-align:center;margin:32px 0">
            <a href="${appUrl}" style="background:#1B3A6B;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
              View My Team
            </a>
          </div>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
          <p style="color:#9ca3af;font-size:12px;text-align:center">
            You received this because a coach added you to their roster on First Whistle.
          </p>
        </div>
      `,
    });
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
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
          <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:10px;padding:16px 20px;margin-bottom:20px">
            <p style="color:white;font-weight:700;font-size:16px;margin:0">First Whistle</p>
          </div>
          <p style="color:#111827;font-size:15px">Hi ${userName},</p>
          <p style="color:#111827;font-weight:600">${notif.title}</p>
          <p style="color:#374151">${notif.message}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
          <p style="color:#9ca3af;font-size:12px;text-align:center">Sent via First Whistle</p>
        </div>
      `,
    });
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
    const existing: any[] = eventData.rsvps ?? [];
    const filtered = existing.filter((r: any) => r.playerId !== playerId);
    filtered.push({ playerId, name: name ?? 'Guest', response, respondedAt: new Date().toISOString() });
    await eventRef.update({ rsvps: filtered, updatedAt: new Date().toISOString() });

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
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
              <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:10px;padding:16px 20px;margin-bottom:20px">
                <p style="color:white;font-weight:700;font-size:16px;margin:0">First Whistle</p>
                <p style="color:rgba(255,255,255,0.8);font-size:12px;margin:2px 0 0">${esc(teamName)}</p>
              </div>

              <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6b7280;margin-bottom:20px">
                <tr><td style="padding:3px 8px 3px 0;width:60px">From</td><td style="color:#111827;font-weight:600">${esc(senderName)} · ${esc(teamName)}</td></tr>
                <tr><td style="padding:3px 8px 3px 0">To</td><td style="color:#111827">${esc(recipient.name)} &lt;${esc(recipient.email)}&gt;</td></tr>
                <tr><td style="padding:3px 8px 3px 0">Event</td><td style="color:#111827;font-weight:600">${esc(eventTitle)}</td></tr>
                <tr><td style="padding:3px 8px 3px 0">Date</td><td style="color:#111827">${esc(eventDate)}</td></tr>
                <tr><td style="padding:3px 8px 3px 0">Time</td><td style="color:#111827">${esc(eventTime)}</td></tr>
                ${eventLocation ? `<tr><td style="padding:3px 8px 3px 0">Location</td><td style="color:#111827">${esc(eventLocation)}</td></tr>` : ''}
              </table>

              <p style="color:#111827;font-size:15px;font-weight:600;text-align:center;margin:0 0 20px">Will you be there, ${esc(recipient.name.split(' ')[0])}?</p>

              <div style="text-align:center;margin-bottom:24px">
                <a href="${yesUrl}" style="${btnStyle('#15803d')}">Yes, I'll be there</a>
                <a href="${maybeUrl}" style="${btnStyle('#d97706')}">Maybe</a>
                <a href="${noUrl}" style="${btnStyle('#dc2626')}">Can't make it</a>
              </div>

              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
              <p style="color:#9ca3af;font-size:12px;text-align:center">Sent via First Whistle</p>
            </div>
          `,
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

    const emails: { name: string; address: string }[] = [];
    for (const p of playersSnap.docs) {
      const d = p.data();
      const name: string = `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim() || 'Player';
      const addrs: string[] = [
        d.email,
        d.parentContact?.parentEmail,
        d.parentContact2?.parentEmail,
      ].filter((e: any): e is string => typeof e === 'string' && e.trim().length > 0);
      addrs.forEach(address => emails.push({ name, address }));
    }

    if (!emails.length) {
      console.log('onEventCreated: no email addresses found for teams', teamIds);
      return;
    }

    let teamName = '';
    if (teamIds[0]) {
      const teamDoc = await admin.firestore().doc(`teams/${teamIds[0]}`).get();
      teamName = teamDoc.data()?.name ?? '';
    }

    const title: string = ev.title ?? 'New Event';
    const date: string = ev.date ?? '';
    const time: string = ev.startTime ?? '';
    const location: string = ev.location ?? '';
    const type: string = ev.type ?? 'event';

    const transporter = createTransporter();

    await Promise.allSettled(emails.map(({ name, address }) =>
      transporter.sendMail({
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
          `View your schedule: ${APP_URL}`,
        ].filter(Boolean).join('\n'),
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
            <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:10px;padding:16px 20px;margin-bottom:20px">
              <p style="color:white;font-weight:700;font-size:16px;margin:0">First Whistle</p>
              ${teamName ? `<p style="color:rgba(255,255,255,0.8);font-size:12px;margin:2px 0 0">${teamName}</p>` : ''}
            </div>
            <p style="color:#111827;font-size:15px;font-weight:600;margin:0 0 16px">A new ${type} has been scheduled</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6b7280;margin-bottom:24px">
              <tr><td style="padding:4px 8px 4px 0;width:80px">Event</td><td style="color:#111827;font-weight:600">${title}</td></tr>
              <tr><td style="padding:4px 8px 4px 0">Date</td><td style="color:#111827">${date}</td></tr>
              <tr><td style="padding:4px 8px 4px 0">Time</td><td style="color:#111827">${time}</td></tr>
              ${location ? `<tr><td style="padding:4px 8px 4px 0">Location</td><td style="color:#111827">${location}</td></tr>` : ''}
              ${teamName ? `<tr><td style="padding:4px 8px 4px 0">Team</td><td style="color:#111827">${teamName}</td></tr>` : ''}
            </table>
            <div style="text-align:center;margin-bottom:24px">
              <a href="${APP_URL}" style="background:#1B3A6B;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">View Schedule</a>
            </div>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
            <p style="color:#9ca3af;font-size:12px;text-align:center">Sent via First Whistle</p>
          </div>
        `,
      })
    ));

    console.log(`onEventCreated: notified ${emails.length} address(es) for event "${title}"`);
  }
);

// ─── Scheduled: send 24-hour event reminders (daily 8AM UTC) ─────────────────

export const sendEventReminders = onSchedule(
  {
    schedule: '0 8 * * *',
    secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom, rsvpSecret],
  },
  async () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10); // YYYY-MM-DD

    const eventsSnap = await admin.firestore()
      .collection('events')
      .where('date', '==', tomorrowStr)
      .get();

    if (eventsSnap.empty) {
      console.log(`sendEventReminders: no events on ${tomorrowStr}`);
      return;
    }

    const transporter = createTransporter();
    let totalSent = 0;

    for (const evDoc of eventsSnap.docs) {
      const ev = evDoc.data();
      const teamIds: string[] = ev.teamIds ?? [];
      if (!teamIds.length) continue;

      const playersSnap = await admin.firestore()
        .collection('players')
        .where('teamId', 'in', teamIds.slice(0, 10))
        .get();

      let teamName = '';
      if (teamIds[0]) {
        const teamDoc = await admin.firestore().doc(`teams/${teamIds[0]}`).get();
        teamName = teamDoc.data()?.name ?? '';
      }

      const title: string = ev.title ?? 'Event';
      const date: string = ev.date ?? '';
      const time: string = ev.startTime ?? '';
      const location: string = ev.location ?? '';

      const sends: Promise<any>[] = [];

      const btnStyle = (bg: string) =>
        `display:inline-block;padding:10px 22px;border-radius:8px;background:${bg};color:white;text-decoration:none;font-weight:600;font-size:14px;margin:0 6px`;

      for (const p of playersSnap.docs) {
        const d = p.data();
        const name: string = `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim() || 'Player';
        const firstName: string = d.firstName ?? name.split(' ')[0];
        const addrs: string[] = [
          d.email,
          d.parentContact?.parentEmail,
          d.parentContact2?.parentEmail,
        ].filter((e: any): e is string => typeof e === 'string' && e.trim().length > 0);

        const reminderToken = signRsvpToken(evDoc.id, p.id);
        const base = `${FUNCTIONS_BASE}/rsvpEvent?e=${encodeURIComponent(evDoc.id)}&p=${encodeURIComponent(p.id)}&n=${encodeURIComponent(name)}&t=${reminderToken}`;
        const yesUrl = `${base}&r=yes`;
        const noUrl = `${base}&r=no`;
        const maybeUrl = `${base}&r=maybe`;

        for (const address of addrs) {
          sends.push(
            transporter.sendMail({
              from: emailFrom.value(),
              to: `${name} <${address}>`,
              subject: `First Whistle Reminder: ${title} is tomorrow – RSVP now`,
              text: [
                `Hi ${firstName},`,
                '',
                `This is a reminder that ${title} is tomorrow.`,
                '',
                `Event: ${title}`,
                `Date: ${date}`,
                `Time: ${time}`,
                location ? `Location: ${location}` : '',
                teamName ? `Team: ${teamName}` : '',
                '',
                'Will you be there?',
                `Yes: ${yesUrl}`,
                `Maybe: ${maybeUrl}`,
                `Can't make it: ${noUrl}`,
                '',
                '---',
                'Sent via First Whistle',
              ].filter(Boolean).join('\n'),
              html: `
                <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
                  <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:10px;padding:16px 20px;margin-bottom:20px">
                    <p style="color:white;font-weight:700;font-size:16px;margin:0">First Whistle</p>
                    ${teamName ? `<p style="color:rgba(255,255,255,0.8);font-size:12px;margin:2px 0 0">${teamName}</p>` : ''}
                  </div>
                  <p style="color:#111827;font-size:15px">Hi ${firstName},</p>
                  <p style="color:#374151">This is a reminder that <strong>${title}</strong> is tomorrow.</p>
                  <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6b7280;margin-bottom:24px">
                    <tr><td style="padding:4px 8px 4px 0;width:80px">Event</td><td style="color:#111827;font-weight:600">${title}</td></tr>
                    <tr><td style="padding:4px 8px 4px 0">Date</td><td style="color:#111827">${date}</td></tr>
                    <tr><td style="padding:4px 8px 4px 0">Time</td><td style="color:#111827">${time}</td></tr>
                    ${location ? `<tr><td style="padding:4px 8px 4px 0">Location</td><td style="color:#111827">${location}</td></tr>` : ''}
                    ${teamName ? `<tr><td style="padding:4px 8px 4px 0">Team</td><td style="color:#111827">${teamName}</td></tr>` : ''}
                  </table>
                  <p style="color:#111827;font-size:15px;font-weight:600;text-align:center;margin:0 0 20px">Will you be there, ${firstName}?</p>
                  <div style="text-align:center;margin-bottom:24px">
                    <a href="${yesUrl}" style="${btnStyle('#15803d')}">Yes, I'll be there</a>
                    <a href="${maybeUrl}" style="${btnStyle('#d97706')}">Maybe</a>
                    <a href="${noUrl}" style="${btnStyle('#dc2626')}">Can't make it</a>
                  </div>
                  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
                  <p style="color:#9ca3af;font-size:12px;text-align:center">Sent via First Whistle</p>
                </div>
              `,
            })
          );
        }
      }

      const results = await Promise.allSettled(sends);
      totalSent += results.filter(r => r.status === 'fulfilled').length;
    }

    console.log(`sendEventReminders: sent ${totalSent} reminder(s) for ${eventsSnap.size} event(s) on ${tomorrowStr}`);
  }
);

// ─── Scheduled: send RSVP follow-ups for non-responders (daily 10AM UTC) ──────

export const sendRsvpFollowups = onSchedule(
  {
    schedule: '0 10 * * *',
    secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom, rsvpSecret],
  },
  async () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10); // YYYY-MM-DD

    const eventsSnap = await admin.firestore()
      .collection('events')
      .where('date', '==', tomorrowStr)
      .get();

    if (eventsSnap.empty) {
      console.log(`sendRsvpFollowups: no events on ${tomorrowStr}`);
      return;
    }

    const transporter = createTransporter();
    let totalSent = 0;

    for (const evDoc of eventsSnap.docs) {
      const ev = evDoc.data();
      const eventId = evDoc.id;
      const teamIds: string[] = ev.teamIds ?? [];
      if (!teamIds.length) continue;

      const existingRsvps: any[] = ev.rsvps ?? [];
      const respondedIds = new Set(existingRsvps.map((r: any) => r.playerId));

      const playersSnap = await admin.firestore()
        .collection('players')
        .where('teamId', 'in', teamIds.slice(0, 10))
        .get();

      let teamName = '';
      if (teamIds[0]) {
        const teamDoc = await admin.firestore().doc(`teams/${teamIds[0]}`).get();
        teamName = teamDoc.data()?.name ?? '';
      }

      const title: string = ev.title ?? 'Event';
      const date: string = ev.date ?? '';
      const time: string = ev.startTime ?? '';
      const location: string = ev.location ?? '';

      const sends: Promise<any>[] = [];

      for (const p of playersSnap.docs) {
        if (respondedIds.has(p.id)) continue;

        const d = p.data();
        const name: string = `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim() || 'Player';
        const firstName: string = d.firstName ?? name.split(' ')[0] ?? 'Player';
        const addrs: string[] = [
          d.email,
          d.parentContact?.parentEmail,
          d.parentContact2?.parentEmail,
        ].filter((e: any): e is string => typeof e === 'string' && e.trim().length > 0);

        if (!addrs.length) continue;

        const followupToken = signRsvpToken(eventId, p.id);
        const base = `${FUNCTIONS_BASE}/rsvpEvent?e=${encodeURIComponent(eventId)}&p=${encodeURIComponent(p.id)}&n=${encodeURIComponent(name)}&t=${followupToken}`;
        const yesUrl = `${base}&r=yes`;
        const noUrl = `${base}&r=no`;
        const maybeUrl = `${base}&r=maybe`;

        const btnStyle = (bg: string) =>
          `display:inline-block;padding:10px 22px;border-radius:8px;background:${bg};color:white;text-decoration:none;font-weight:600;font-size:14px;margin:0 6px`;

        for (const address of addrs) {
          sends.push(
            transporter.sendMail({
              from: emailFrom.value(),
              to: `${name} <${address}>`,
              subject: `First Whistle: Don't forget to RSVP \u2013 ${title}`,
              text: [
                `Hi ${firstName},`,
                '',
                `You haven't responded yet to tomorrow's event.`,
                '',
                `Event: ${title}`,
                `Date: ${date}`,
                `Time: ${time}`,
                location ? `Location: ${location}` : '',
                teamName ? `Team: ${teamName}` : '',
                '',
                `Yes: ${yesUrl}`,
                `Maybe: ${maybeUrl}`,
                `Can't make it: ${noUrl}`,
                '',
                '---',
                'Sent via First Whistle',
              ].filter(Boolean).join('\n'),
              html: `
                <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
                  <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:10px;padding:16px 20px;margin-bottom:20px">
                    <p style="color:white;font-weight:700;font-size:16px;margin:0">First Whistle</p>
                    ${teamName ? `<p style="color:rgba(255,255,255,0.8);font-size:12px;margin:2px 0 0">${teamName}</p>` : ''}
                  </div>
                  <p style="color:#111827;font-size:15px">Hi ${firstName},</p>
                  <p style="color:#374151">You haven't responded yet to tomorrow's event.</p>
                  <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6b7280;margin-bottom:24px">
                    <tr><td style="padding:4px 8px 4px 0;width:80px">Event</td><td style="color:#111827;font-weight:600">${title}</td></tr>
                    <tr><td style="padding:4px 8px 4px 0">Date</td><td style="color:#111827">${date}</td></tr>
                    <tr><td style="padding:4px 8px 4px 0">Time</td><td style="color:#111827">${time}</td></tr>
                    ${location ? `<tr><td style="padding:4px 8px 4px 0">Location</td><td style="color:#111827">${location}</td></tr>` : ''}
                    ${teamName ? `<tr><td style="padding:4px 8px 4px 0">Team</td><td style="color:#111827">${teamName}</td></tr>` : ''}
                  </table>
                  <p style="color:#111827;font-size:15px;font-weight:600;text-align:center;margin:0 0 20px">Will you be there, ${firstName}?</p>
                  <div style="text-align:center;margin-bottom:24px">
                    <a href="${yesUrl}" style="${btnStyle('#15803d')}">Yes</a>
                    <a href="${maybeUrl}" style="${btnStyle('#d97706')}">Maybe</a>
                    <a href="${noUrl}" style="${btnStyle('#dc2626')}">Can't make it</a>
                  </div>
                  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
                  <p style="color:#9ca3af;font-size:12px;text-align:center">Sent via First Whistle</p>
                </div>
              `,
            })
          );
        }
      }

      const results = await Promise.allSettled(sends);
      totalSent += results.filter(r => r.status === 'fulfilled').length;
    }

    console.log(`sendRsvpFollowups: sent ${totalSent} follow-up(s) for events on ${tomorrowStr}`);
  }
);

// ─── Event updated → cancellation notifications + game result broadcast ───────

export const onEventCancelled = onDocumentUpdated(
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

    if (!isCancellation && !isResultSet) return;

    const teamIds: string[] = after.teamIds ?? [];
    if (!teamIds.length) return;

    // Fetch all players on the event's teams
    const playersSnap = await admin.firestore()
      .collection('players')
      .where('teamId', 'in', teamIds.slice(0, 10))
      .get();

    if (playersSnap.empty) {
      console.log(`onEventCancelled/onResultSet: no players found for teams`, teamIds);
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
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
              <div style="background:linear-gradient(135deg,#1B3A6B,#0f2a52);border-radius:10px;padding:16px 20px;margin-bottom:20px">
                <p style="color:white;font-weight:700;font-size:16px;margin:0">First Whistle</p>
              </div>
              <p style="color:#111827;font-size:15px">Hi ${firstName},</p>
              <p style="color:#374151"><strong>${eventTitle}</strong> scheduled for ${eventDate} at ${eventTime} has been cancelled.</p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
              <p style="color:#9ca3af;font-size:12px;text-align:center">Sent via First Whistle</p>
            </div>
          `,
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

      console.log(`onEventCancelled: sent ${emails.length} cancellation email(s) and ${notifCount} in-app notification(s) for "${eventTitle}"`);
      } catch (err) {
        console.error('onEventCancelled: cancellation block failed', err);
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

      console.log(`onEventCancelled/onResultSet: sent ${notifCount} result notification(s) for "${eventTitle}" — ${resultSummary}`);
      } catch (err) {
        console.error('onEventCancelled: result broadcast block failed', err);
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

    // Query all users on this team
    const usersSnap = await db.collection('users').where('teamId', '==', teamId).get();

    if (usersSnap.empty) {
      console.log(`sendPostGameBroadcast: no users found for teamId=${teamId}`);
      return { sent: 0 };
    }

    const now = new Date().toISOString();
    const batch = db.batch();
    let notifCount = 0;

    for (const userDoc of usersSnap.docs) {
      const notifRef = db
        .collection('users').doc(userDoc.id)
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

// ─── Weather Alerts for Outdoor Events (every 6 hours) ───────────────────────
//
// Queries for events happening in the next 24–26 hours that:
//   • have a non-empty location
//   • are outdoor (isOutdoor !== false)
//   • have not already had a weather alert sent (weatherAlertSent !== true)
//   • are not cancelled / postponed
//
// For each qualifying event the function:
//   1. Geocodes the location string via Open-Meteo geocoding API
//   2. Fetches hourly precipitation probability from Open-Meteo forecast API
//   3. If precipitation probability at the event hour exceeds RAIN_THRESHOLD,
//      writes an in-app notification to the team coach's notifications subcollection
//      and marks the event doc with weatherAlertSent: true to prevent duplicates.
//
// Open-Meteo is free and requires no API key.

const RAIN_THRESHOLD = 70; // percent — alert if probability exceeds this

interface GeocodingResult {
  results?: Array<{ latitude: number; longitude: number; name: string }>;
}

interface ForecastResult {
  hourly?: {
    time: string[];
    precipitation_probability: number[];
  };
}

/**
 * Geocode a free-text location string.
 * Returns { lat, lon } or null if the location cannot be resolved.
 */
async function geocodeLocation(location: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn(`checkWeatherAlerts: geocoding HTTP ${res.status} for "${location}"`);
      return null;
    }
    const data = (await res.json()) as GeocodingResult;
    const first = data.results?.[0];
    if (!first) {
      console.log(`checkWeatherAlerts: no geocoding result for "${location}"`);
      return null;
    }
    return { lat: first.latitude, lon: first.longitude };
  } catch (err) {
    console.warn(`checkWeatherAlerts: geocoding failed for "${location}"`, err);
    return null;
  }
}

/**
 * Fetch the precipitation probability (0–100) at the given UTC ISO hour string.
 * Returns null if the forecast cannot be retrieved or the hour is not present.
 */
async function getPrecipitationProbability(
  lat: number,
  lon: number,
  isoHour: string,
): Promise<number | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=precipitation_probability` +
    `&timezone=auto` +
    `&forecast_days=3`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn(`checkWeatherAlerts: forecast HTTP ${res.status} for lat=${lat} lon=${lon}`);
      return null;
    }
    const data = (await res.json()) as ForecastResult;
    const times = data.hourly?.time;
    const probs = data.hourly?.precipitation_probability;
    if (!times || !probs) return null;

    // Match on the first 13 chars (YYYY-MM-DDTHH) to be timezone-tolerant
    const targetPrefix = isoHour.slice(0, 13);
    const idx = times.findIndex(t => t.startsWith(targetPrefix));
    if (idx === -1) {
      console.log(`checkWeatherAlerts: no forecast slot found for "${targetPrefix}"`);
      return null;
    }
    return probs[idx] ?? null;
  } catch (err) {
    console.warn(`checkWeatherAlerts: forecast fetch failed`, err);
    return null;
  }
}

export const checkWeatherAlerts = onSchedule(
  { schedule: '0 */6 * * *' }, // every 6 hours
  async () => {
    const db = admin.firestore();
    const now = new Date();

    // Window: events starting between 24 h and 26 h from now
    const windowStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const windowEnd   = new Date(now.getTime() + 26 * 60 * 60 * 1000);

    // We query by date string (YYYY-MM-DD). Compute the set of date strings
    // that fall within the 24–26 h window (usually just one, occasionally two
    // when the window straddles midnight).
    const dateStrings = new Set<string>();
    dateStrings.add(windowStart.toISOString().slice(0, 10));
    dateStrings.add(windowEnd.toISOString().slice(0, 10));

    console.log(`checkWeatherAlerts: scanning dates ${[...dateStrings].join(', ')}`);

    let alertsSent = 0;

    for (const dateStr of dateStrings) {
      const eventsSnap = await db
        .collection('events')
        .where('date', '==', dateStr)
        .where('weatherAlertSent', '!=', true)
        .get();

      for (const evDoc of eventsSnap.docs) {
        const ev = evDoc.data();

        // Skip indoor, cancelled, or postponed events
        if (ev['isOutdoor'] === false) continue;
        const status: string = ev['status'] ?? 'scheduled';
        if (status === 'cancelled' || status === 'postponed') continue;

        const location: string | undefined = ev['location'];
        const venueId: string | undefined = ev['venueId'];

        // Attempt to use pre-geocoded venue lat/lng before falling back to geocoding
        let coords: { lat: number; lon: number } | null = null;

        if (venueId) {
          // Try each team's coach uid as the potential venue owner
          const teamIds: string[] = ev['teamIds'] ?? [];
          for (const teamId of teamIds.slice(0, 5)) {
            const teamDoc = await db.doc(`teams/${teamId}`).get();
            const teamData = teamDoc.data();
            const ownerUid: string | undefined = teamData?.['createdBy'];
            if (!ownerUid) continue;
            const venueDoc = await db.doc(`users/${ownerUid}/venues/${venueId}`).get();
            const venueData = venueDoc.data();
            if (venueData?.['lat'] != null && venueData?.['lng'] != null) {
              coords = { lat: venueData['lat'] as number, lon: venueData['lng'] as number };
              break;
            }
          }
        }

        if (!coords) {
          if (!location?.trim()) continue;
          coords = await geocodeLocation(location);
        }
        if (!coords) continue;

        // Build the event's start datetime in ISO format
        const startTime: string = ev['startTime'] ?? '00:00'; // HH:MM
        const eventIsoHour = `${dateStr}T${startTime}`; // e.g. 2026-03-26T14:00

        // Verify it actually falls within our alert window
        const eventTs = new Date(`${dateStr}T${startTime}:00Z`).getTime();
        if (eventTs < windowStart.getTime() || eventTs > windowEnd.getTime()) continue;

        // Fetch precipitation probability
        const prob = await getPrecipitationProbability(coords.lat, coords.lon, eventIsoHour);
        if (prob === null) continue;

        console.log(`checkWeatherAlerts: event "${ev['title']}" (${evDoc.id}) location="${location ?? venueId}" prob=${prob}%`);

        if (prob <= RAIN_THRESHOLD) continue;

        // ── Identify coach UID ───────────────────────────────────────────────
        // Priority: team.coachId → team.createdBy
        const teamIds: string[] = ev['teamIds'] ?? [];
        const coachUids = new Set<string>();

        for (const teamId of teamIds.slice(0, 10)) {
          const teamDoc = await db.doc(`teams/${teamId}`).get();
          const teamData = teamDoc.data();
          if (!teamData) continue;
          const coachId: string | undefined = teamData['coachId'] ?? teamData['createdBy'];
          if (coachId) coachUids.add(coachId);
        }

        if (!coachUids.size) {
          console.log(`checkWeatherAlerts: no coach found for event ${evDoc.id}`);
          continue;
        }

        // ── Write in-app notification for each coach ─────────────────────────
        const eventTitle: string = ev['title'] ?? 'Event';
        const deepLink = `${APP_URL}/?event=${evDoc.id}`;
        const notifTitle = `Weather alert: ${eventTitle}`;
        const notifMessage =
          `Rain probability is ${prob}% at event time. ` +
          `Tap to review and cancel or confirm: ${deepLink}`;
        const createdAt = new Date().toISOString();

        const batch = db.batch();
        for (const uid of coachUids) {
          const notifRef = db
            .collection('users').doc(uid)
            .collection('notifications').doc();
          batch.set(notifRef, {
            id: notifRef.id,
            type: 'weather_alert',
            title: notifTitle,
            message: notifMessage,
            relatedEventId: evDoc.id,
            isRead: false,
            createdAt,
          });
        }

        // Mark the event so we don't re-alert
        batch.update(evDoc.ref, {
          weatherAlertSent: true,
          updatedAt: createdAt,
        });

        await batch.commit();
        alertsSent++;

        console.log(
          `checkWeatherAlerts: alert sent for event "${eventTitle}" (${evDoc.id}), ` +
          `prob=${prob}%, coaches=${[...coachUids].join(', ')}`,
        );
      }
    }

    console.log(`checkWeatherAlerts: done — ${alertsSent} alert(s) sent`);
  },
);
// ─── Scheduled: send weekly digest every Monday at 7AM UTC ───────────────────

export const sendWeeklyDigest = onSchedule('0 7 * * 1', async () => {
  const db = admin.firestore();

  // Build date range: today (Monday) through Sunday
  const monday = new Date();
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const mondayStr = monday.toISOString().slice(0, 10); // YYYY-MM-DD
  const sundayStr = sunday.toISOString().slice(0, 10);

  console.log(`sendWeeklyDigest: querying events from ${mondayStr} to ${sundayStr}`);

  const eventsSnap = await db.collection('events')
    .where('date', '>=', mondayStr)
    .where('date', '<=', sundayStr)
    .get();

  if (eventsSnap.empty) {
    console.log('sendWeeklyDigest: no events this week \u2014 skipping');
    return;
  }

  interface WeekEvent {
    id: string;
    title: string;
    date: string;
    startTime: string;
    teamId: string;
    rsvps: { response: string }[];
    playerCount: number;
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function dayOfWeek(dateStr: string): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(Date.UTC(year!, (month! - 1), day!));
    return dayNames[d.getUTCDay()] ?? dateStr;
  }

  // Group events by teamId
  const teamEventMap = new Map<string, WeekEvent[]>();
  for (const evDoc of eventsSnap.docs) {
    const ev = evDoc.data();
    const teamIds: string[] = ev.teamIds ?? (ev.teamId ? [ev.teamId as string] : []);
    for (const tid of teamIds) {
      if (!teamEventMap.has(tid)) teamEventMap.set(tid, []);
      teamEventMap.get(tid)!.push({
        id: evDoc.id,
        title: (ev.title as string) ?? 'Event',
        date: (ev.date as string) ?? '',
        startTime: (ev.startTime as string) ?? '',
        teamId: tid,
        rsvps: (ev.rsvps as { response: string }[]) ?? [],
        playerCount: (ev.playerCount as number) ?? 0,
      });
    }
  }

  if (teamEventMap.size === 0) {
    console.log('sendWeeklyDigest: events found but none have teamIds \u2014 skipping');
    return;
  }

  // Fetch users per team (chunked for Firestore `in` limit of 30)
  const allTeamIds = [...teamEventMap.keys()];
  const usersByTeam = new Map<string, { uid: string; role: string; weeklyDigestEnabled: boolean }[]>();

  for (let i = 0; i < allTeamIds.length; i += 30) {
    const chunk = allTeamIds.slice(i, i + 30);
    const usersSnap = await db.collection('users').where('teamId', 'in', chunk).get();
    for (const userDoc of usersSnap.docs) {
      const u = userDoc.data();
      const tid = u.teamId as string | undefined;
      if (!tid) continue;
      if (!usersByTeam.has(tid)) usersByTeam.set(tid, []);
      usersByTeam.get(tid)!.push({
        uid: userDoc.id,
        role: (u.role as string) ?? 'player',
        weeklyDigestEnabled: u.weeklyDigestEnabled !== false,
      });
    }
  }

  const createdAt = new Date().toISOString();
  let firestoreBatch = db.batch();
  let batchCount = 0;
  let totalNotifs = 0;

  async function flushBatch(): Promise<void> {
    if (batchCount === 0) return;
    await firestoreBatch.commit();
    firestoreBatch = db.batch();
    batchCount = 0;
  }

  for (const [teamId, events] of teamEventMap.entries()) {
    const members = usersByTeam.get(teamId) ?? [];
    if (!members.length) continue;

    // Sort events by date then start time
    events.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

    // Identify events with low RSVPs (confirmed < half of total players)
    const lowRsvpEvents = events.filter(ev => {
      const confirmed = ev.rsvps.filter(r => r.response === 'yes').length;
      const total = ev.playerCount > 0 ? ev.playerCount : Math.max(ev.rsvps.length, 1);
      return confirmed < total / 2;
    });

    for (const member of members) {
      if (!member.weeklyDigestEnabled) continue;

      const eventLines = events.map(ev => {
        const dow = dayOfWeek(ev.date);
        const time = ev.startTime ? ` at ${ev.startTime}` : '';
        return `${ev.title} on ${dow}${time}`;
      });

      let message = `You have ${events.length} event${events.length !== 1 ? 's' : ''} this week: ${eventLines.join(', ')}.`;

      if ((member.role === 'coach' || member.role === 'admin') && lowRsvpEvents.length > 0) {
        const lowLines = lowRsvpEvents.map(ev => {
          const confirmed = ev.rsvps.filter(r => r.response === 'yes').length;
          const total = ev.playerCount > 0 ? ev.playerCount : Math.max(ev.rsvps.length, 1);
          return `${ev.title} on ${dayOfWeek(ev.date)} (${confirmed}/${total} responded)`;
        });
        message += ` \u26a0 Low RSVPs: ${lowLines.join(', ')}.`;
      }

      const notifRef = db.collection('users').doc(member.uid).collection('notifications').doc();
      firestoreBatch.set(notifRef, {
        id: notifRef.id,
        type: 'info',
        title: 'This Week in Sport',
        message,
        isRead: false,
        createdAt,
      });
      batchCount++;
      totalNotifs++;

      if (batchCount >= 499) {
        await flushBatch();
      }
    }
  }

  await flushBatch();
  console.log(`sendWeeklyDigest: wrote ${totalNotifs} notification(s) for week of ${mondayStr}`);
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
      const stripped: Record<string, admin.firestore.FieldValue> = {};
      for (const key of SENSITIVE_KEYS) {
        if (data[key] !== undefined) {
          stripped[key] = admin.firestore.FieldValue.delete();
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

// ─── Schedule Wizard ──────────────────────────────────────────────────────────

export interface RecurringVenueWindow {
  dayOfWeek: number;   // 0 = Sunday … 6 = Saturday
  startTime: string;   // 'HH:MM'
  endTime: string;     // 'HH:MM'
}

export interface VenueInput {
  name: string;
  concurrentPitches: number;
  // New format (v2 wizard)
  availabilityWindows?: RecurringVenueWindow[];
  fallbackWindows?: RecurringVenueWindow[];
  // Legacy format (v1 wizard) — kept for backwards compatibility
  availableDays?: string[];
  availableTimeStart?: string;
  availableTimeEnd?: string;
  blackoutDates?: string[];
}

export interface TeamInput {
  id: string;
  name: string;
  homeVenue?: string;              // venue name
  earliestKickOff?: string;        // e.g. '10:00'
}

export interface ScheduleWizardInput {
  leagueId: string;
  leagueName: string;
  seasonStart: string;             // ISO date
  seasonEnd: string;               // ISO date
  matchDurationMinutes: number;
  bufferMinutes: number;
  format: 'single_round_robin' | 'double_round_robin' | 'single_elimination' | 'double_elimination' | 'group_then_knockout';
  teams: TeamInput[];
  venues: VenueInput[];
  blackoutDates?: string[];        // season-wide blackout ISO dates
  minRestDays?: number;            // default 6
  maxConsecutiveAway?: number;     // default 2
  groupCount?: number;             // for group_then_knockout
  groupAdvance?: number;           // top N from each group advance
}

export interface GeneratedFixture {
  round: number;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  date: string;       // ISO date e.g. '2026-04-05'
  startTime: string;  // e.g. '10:00'
  venue: string;
  stage?: string;     // e.g. 'Group A', 'Quarter-final', 'Final'
}

export interface ScheduleWizardOutput {
  fixtures: GeneratedFixture[];
  conflicts: Array<{
    severity: 'hard' | 'soft';
    description: string;
    constraintId?: string;
  }>;
  stats: {
    totalFixtures: number;
    assignedFixtures: number;
    unassignedFixtures: number;
    feasible: boolean;
  };
  summary: string;
}

export const generateLeagueSchedule = onCall(
  {
    timeoutSeconds: 300,
    memory: '512MiB',
    secrets: [anthropicKey],
  },
  async (request): Promise<ScheduleWizardOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    const role = await assertAdminOrCoach(request.auth.uid);
    if (role !== 'admin' && role !== 'league_manager') {
      throw new HttpsError('permission-denied', 'Only league managers and admins can generate schedules.');
    }

    await checkRateLimit(request.auth.uid, 'generateSchedule', 5, 60_000);

    const input = request.data as ScheduleWizardInput;

    if (!input.leagueId || !input.seasonStart || !input.seasonEnd || !input.teams?.length || !input.venues?.length) {
      throw new HttpsError('invalid-argument', 'Missing required schedule inputs.');
    }
    if (input.teams.length < 2) {
      throw new HttpsError('invalid-argument', 'At least 2 teams are required to generate a schedule.');
    }

    const client = new Anthropic({ apiKey: anthropicKey.value() });

    const DAY_NAMES_CF = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    function venueWindowsText(windows: RecurringVenueWindow[] | undefined | null): string {
      if (!windows?.length) return 'not specified';
      return windows.map(w => `${DAY_NAMES_CF[w.dayOfWeek]} ${w.startTime}–${w.endTime}`).join(', ');
    }

    function venueAvailabilityText(v: VenueInput): string {
      if (v.availabilityWindows?.length) {
        const primary = `primary: ${venueWindowsText(v.availabilityWindows)}`;
        const fallback = v.fallbackWindows?.length ? `; fallback: ${venueWindowsText(v.fallbackWindows)}` : '';
        return `available ${primary}${fallback}`;
      }
      // Legacy format
      const days = v.availableDays?.join('/') ?? 'unspecified days';
      const time = v.availableTimeStart && v.availableTimeEnd ? `${v.availableTimeStart}–${v.availableTimeEnd}` : 'unspecified times';
      return `available ${days} ${time}`;
    }

    const formatDescriptions: Record<string, string> = {
      single_round_robin: 'Single round-robin: each pair of teams plays once.',
      double_round_robin: 'Double round-robin: each pair of teams plays twice (home and away).',
      single_elimination: 'Single elimination knockout bracket. Teams are seeded. Losers are eliminated immediately. Byes are assigned if the team count is not a power of 2.',
      double_elimination: 'Double elimination: teams must lose twice to be eliminated. Winners and Losers brackets merge in a Grand Final.',
      group_then_knockout: `Group stage (${input.groupCount ?? 2} groups, top ${input.groupAdvance ?? 2} advance) followed by single-elimination knockout.`,
    };

    const systemPrompt = `You are an expert sports scheduling engine. Your job is to produce a complete, valid fixture schedule for a sports league or tournament.

You must output ONLY valid JSON matching the exact schema provided. No explanatory text, no markdown, no code fences — raw JSON only.

Rules you must follow:
- Hard constraints must NEVER be violated (no double-booking, no team plays twice on same day, venues available on scheduled day/time, no fixtures on blackout dates).
- Soft constraints should be respected as much as possible (min rest days, home/away balance, max consecutive away).
- If a complete schedule is infeasible, assign as many fixtures as possible and report the rest as conflicts.
- Fixture dates must fall between seasonStart and seasonEnd inclusive.
- Fixture times must fall within venue available hours.
- Concurrent pitch limits at each venue must be respected.
- For knockout formats: clearly label the stage (e.g. "Round of 16", "Quarter-final", "Semi-final", "Final").
- For group+knockout: label group stage fixtures with "Group A", "Group B" etc.`;

    const userMessage = `Generate a complete fixture schedule for the following league/tournament:

**League:** ${input.leagueName}
**Format:** ${formatDescriptions[input.format] ?? input.format}
**Season:** ${input.seasonStart} to ${input.seasonEnd}
**Match duration:** ${input.matchDurationMinutes} minutes + ${input.bufferMinutes} min buffer between games at same venue
**Minimum rest days between games per team:** ${input.minRestDays ?? 6}
**Maximum consecutive away games:** ${input.maxConsecutiveAway ?? 2}

**Teams (${input.teams.length}):**
${input.teams.map((t, i) => `${i + 1}. ${t.name} (id: ${t.id})${t.homeVenue ? `, home venue: ${t.homeVenue}` : ''}${t.earliestKickOff ? `, earliest kick-off: ${t.earliestKickOff}` : ''}`).join('\n')}

**Venues (${input.venues.length}):**
${input.venues.map(v => `- ${v.name}: ${v.concurrentPitches} pitch(es), ${venueAvailabilityText(v)}${v.blackoutDates?.length ? `, blackout: ${v.blackoutDates.join(', ')}` : ''}`).join('\n')}

**Season-wide blackout dates:** ${input.blackoutDates?.length ? input.blackoutDates.join(', ') : 'None'}

Output JSON with this exact structure:
{
  "fixtures": [
    {
      "round": 1,
      "homeTeamId": "<team id>",
      "homeTeamName": "<team name>",
      "awayTeamId": "<team id>",
      "awayTeamName": "<team name>",
      "date": "YYYY-MM-DD",
      "startTime": "HH:MM",
      "venue": "<venue name>",
      "stage": "<optional: e.g. Group A, Quarter-final>"
    }
  ],
  "conflicts": [
    {
      "severity": "hard|soft",
      "description": "<plain English explanation>",
      "constraintId": "<optional: HC-01, SC-01, etc.>"
    }
  ],
  "stats": {
    "totalFixtures": <number>,
    "assignedFixtures": <number>,
    "unassignedFixtures": <number>,
    "feasible": <true|false>
  },
  "summary": "<1-2 sentence plain-English summary of the schedule quality and any notable issues>"
}`;

    let rawContent = '';
    try {
      const stream = client.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 64000,
        thinking: { type: 'adaptive' },
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const message = await stream.finalMessage();
      for (const block of message.content) {
        if (block.type === 'text') {
          rawContent = block.text;
          break;
        }
      }
    } catch (err) {
      console.error('Anthropic API error:', JSON.stringify(err));
      throw new HttpsError('internal', 'Schedule generation failed. Please try again.');
    }

    // Strip any accidental markdown fences
    const jsonText = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    let result: ScheduleWizardOutput;
    try {
      result = JSON.parse(jsonText) as ScheduleWizardOutput;
      if (!Array.isArray(result.fixtures)) {
        throw new Error('LLM response missing fixtures array');
      }
    } catch (err) {
      console.error('Failed to parse LLM output:', (err as Error).message, jsonText.slice(0, 500));
      throw new HttpsError('internal', 'Schedule generation returned an unexpected format. Please try again.');
    }

    return result;
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

    // Auth check: caller must be the owner
    if (request.auth?.uid !== ownerUid) {
      throw new HttpsError('permission-denied', 'Not authorised');
    }

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

