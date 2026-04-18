/**
 * Emulator-tier seed script.
 *
 * Runs once before Playwright against the Firebase Emulator Suite. Creates a
 * known, idempotent dataset that @emu specs can rely on:
 *   - 5 test users (admin, coach, lm, parent, player) with fixed UIDs/emails
 *   - current-version consent docs for each (prevents ConsentUpdateModal)
 *   - 1 league, 1 season, 1 venue, 2 teams, 1 past-dated game
 *
 * Not secret: these credentials only exist inside a local Firebase emulator
 * process. They cannot reach staging or production.
 *
 * Invoked as `npx tsx e2e/seed-emulator.ts` AFTER emulators are running and
 * BEFORE Playwright starts. The Firebase Admin SDK connects to the emulators
 * automatically when FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST
 * are set in the environment.
 *
 * Idempotent: re-running will reconcile state without creating duplicates.
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'first-whistle-e76f4';

// ── Test credentials (emulator-only) ────────────────────────────────────────

export const EMU_PASSWORD = 'TestPass123!';

export interface EmuUser {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'coach' | 'league_manager' | 'parent' | 'player';
  isAdminClaim?: boolean;
}

export const EMU_USERS: EmuUser[] = [
  { uid: 'emu-admin', email: 'admin@emu.test', displayName: 'Emu Admin', role: 'admin', isAdminClaim: true },
  { uid: 'emu-coach', email: 'coach@emu.test', displayName: 'Emu Coach', role: 'coach' },
  { uid: 'emu-lm',    email: 'lm@emu.test',    displayName: 'Emu League Manager', role: 'league_manager' },
  { uid: 'emu-parent', email: 'parent@emu.test', displayName: 'Emu Parent', role: 'parent' },
  { uid: 'emu-player', email: 'player@emu.test', displayName: 'Emu Player', role: 'player' },
];

export const EMU_IDS = {
  leagueId: 'emu-league',
  seasonId: 'emu-season',
  venueId: 'emu-venue',
  teamAId: 'emu-team-a',
  teamBId: 'emu-team-b',
  eventId: 'emu-event',
  // Invite-signup allowlist bypass spec (fix/invite-signup-allowlist)
  inviteSecret: 'emu-invite-secret-001',
} as const;

const LEGAL_VERSION = '1.0';

// ── Helpers ─────────────────────────────────────────────────────────────────

function assertEmulatorEnv(): void {
  const missing: string[] = [];
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) missing.push('FIREBASE_AUTH_EMULATOR_HOST');
  if (!process.env.FIRESTORE_EMULATOR_HOST) missing.push('FIRESTORE_EMULATOR_HOST');
  if (missing.length > 0) {
    throw new Error(
      `seed-emulator.ts requires ${missing.join(' and ')} to be set. ` +
      'Run this script via `firebase emulators:exec` or set the vars manually.',
    );
  }
}

function yesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Seed: Auth users ────────────────────────────────────────────────────────

async function seedUser(user: EmuUser): Promise<void> {
  const auth = getAuth();

  try {
    await auth.getUser(user.uid);
    await auth.updateUser(user.uid, {
      email: user.email,
      password: EMU_PASSWORD,
      displayName: user.displayName,
      emailVerified: true,
    });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== 'auth/user-not-found') throw err;
    await auth.createUser({
      uid: user.uid,
      email: user.email,
      password: EMU_PASSWORD,
      displayName: user.displayName,
      emailVerified: true,
    });
  }

  if (user.isAdminClaim) {
    await auth.setCustomUserClaims(user.uid, { admin: true });
  }
}

// ── Seed: UserProfile + consents ────────────────────────────────────────────

async function seedProfile(user: EmuUser): Promise<void> {
  const db = getFirestore();
  const membership: Record<string, unknown> = { role: user.role, isPrimary: true };
  if (user.role === 'coach' || user.role === 'parent' || user.role === 'player') {
    membership.teamId = EMU_IDS.teamAId;
  }
  if (user.role === 'league_manager') {
    membership.leagueId = EMU_IDS.leagueId;
  }

  const profile: Record<string, unknown> = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    memberships: [membership],
    activeContext: 0,
    createdAt: new Date().toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (user.role === 'coach' || user.role === 'parent' || user.role === 'player') {
    profile.teamId = EMU_IDS.teamAId;
  }
  if (user.role === 'league_manager') {
    profile.leagueId = EMU_IDS.leagueId;
  }

  await db.doc(`users/${user.uid}`).set(profile, { merge: true });

  // Consent docs — current version, so ConsentUpdateModal never appears.
  const agreedAt = new Date().toISOString();
  await Promise.all([
    db.doc(`users/${user.uid}/consents/termsOfService`).set({ version: LEGAL_VERSION, agreedAt }),
    db.doc(`users/${user.uid}/consents/privacyPolicy`).set({ version: LEGAL_VERSION, agreedAt }),
    db.doc(`users/${user.uid}/consents/liabilityLimitations`).set({ version: LEGAL_VERSION, agreedAt }),
  ]);
}

// ── Seed: Fixtures (league, season, venue, teams, event) ───────────────────

async function seedFixtures(): Promise<void> {
  const db = getFirestore();
  const now = FieldValue.serverTimestamp();
  const year = new Date().getFullYear();

  await db.doc(`leagues/${EMU_IDS.leagueId}`).set({
    name: 'Emu League',
    managerIds: ['emu-lm'],
    isE2eData: true,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  await db.doc(`venues/${EMU_IDS.venueId}`).set({
    name: 'Emu Field',
    address: '1 Emulator Way',
    isOutdoor: true,
    fields: [],
    ownerUid: 'emu-admin',
    isE2eData: true,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  await db.doc(`teams/${EMU_IDS.teamAId}`).set({
    name: 'Emu Team A',
    coachId: 'emu-coach',
    coachIds: ['emu-coach'],
    leagueIds: [EMU_IDS.leagueId],
    homeVenueId: EMU_IDS.venueId,
    sportType: 'soccer',
    color: '#3B82F6',
    createdBy: 'emu-coach',
    ownerName: 'Emu Coach',
    isE2eData: true,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  await db.doc(`teams/${EMU_IDS.teamBId}`).set({
    name: 'Emu Team B',
    coachIds: [],
    leagueIds: [EMU_IDS.leagueId],
    sportType: 'soccer',
    color: '#EF4444',
    createdBy: 'emu-admin',
    ownerName: 'Emu Seed',
    isE2eData: true,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  await db.doc(`leagues/${EMU_IDS.leagueId}/seasons/${EMU_IDS.seasonId}`).set({
    name: `Emu Season ${year}`,
    leagueId: EMU_IDS.leagueId,
    teamIds: [EMU_IDS.teamAId, EMU_IDS.teamBId],
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    status: 'active',
    gamesPerTeam: 1,
    homeAwayBalance: true,
    createdBy: 'emu-admin',
    isE2eData: true,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  await db.doc(`events/${EMU_IDS.eventId}`).set({
    title: 'Emu Test Game',
    type: 'game',
    teamIds: [EMU_IDS.teamAId, EMU_IDS.teamBId],
    homeTeamId: EMU_IDS.teamAId,
    awayTeamId: EMU_IDS.teamBId,
    leagueId: EMU_IDS.leagueId,
    seasonId: EMU_IDS.seasonId,
    venueId: EMU_IDS.venueId,
    date: yesterdayIso(),
    startTime: '10:00',
    endTime: '11:30',
    status: 'scheduled',
    isRecurring: false,
    isE2eData: true,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
}

// ── Seed: Invite-signup allowlist bypass data ────────────────────────────────
// Seeds the data required by e2e/emulator/invite-signup-allowlist.emu.spec.ts:
//   - system/signupConfig with open=false (no allowedEmails/Domains) so the
//     allowlist gate would normally block any unknown address
//   - an invite doc for invitee@external.test with EMU_IDS.inviteSecret so
//     previewInvite() can verify the secret and return { valid: true, email }
// The invitee is intentionally NOT a seeded Auth user — the spec tests the
// first-time parent signup path (no prior account exists).

async function seedInviteSignupData(): Promise<void> {
  const db = getFirestore();
  const now = FieldValue.serverTimestamp();

  // Closed signup — allowlist would normally block invitee@external.test.
  await db.doc('system/signupConfig').set(
    { open: false, allowedEmails: [], allowedDomains: [] },
    { merge: true },
  );

  // Pending invite: previewInvite queries by inviteSecret + status=='pending'.
  // autoVerify=true so checkInviteAutoVerify skips email verification post-signup.
  const inviteId = `invitee-external-test_${EMU_IDS.teamAId}_parent`;
  await db.doc(`invites/${inviteId}`).set(
    {
      email: 'invitee@external.test',
      teamId: EMU_IDS.teamAId,
      role: 'parent',
      inviteSecret: EMU_IDS.inviteSecret,
      status: 'pending',
      autoVerify: true,
      isE2eData: true,
      invitedAt: now,
    },
    { merge: true },
  );
}

// ── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  assertEmulatorEnv();

  if (getApps().length === 0) {
    initializeApp({ projectId: PROJECT_ID });
  }

  console.log(`[seed-emulator] Seeding project=${PROJECT_ID}`);
  console.log(`[seed-emulator] Auth emulator:      ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
  console.log(`[seed-emulator] Firestore emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`);

  for (const user of EMU_USERS) {
    await seedUser(user);
    console.log(`[seed-emulator] Auth user ready: ${user.email} (${user.role})`);
  }

  await seedFixtures();
  console.log('[seed-emulator] Fixtures ready (league/season/venue/teams/event)');

  for (const user of EMU_USERS) {
    await seedProfile(user);
    console.log(`[seed-emulator] Profile + consents ready: ${user.email}`);
  }

  await seedInviteSignupData();
  console.log('[seed-emulator] Invite-signup allowlist bypass data ready');

  console.log('[seed-emulator] Done.');
}

main().catch(err => {
  console.error('[seed-emulator] FATAL:', err);
  process.exit(1);
});
