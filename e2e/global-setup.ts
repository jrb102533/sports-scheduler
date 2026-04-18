/**
 * Playwright global setup — authenticates each role once per CI run,
 * then seeds a known isolated dataset into Firestore for E2E tests.
 *
 * Auth flow:
 *   Logs in via the real login form and saves the resulting browser storage
 *   state (cookies + localStorage, including the Firebase ID token) to
 *   e2e/.auth/{role}.json.
 *
 *   Each role fixture in auth.fixture.ts then loads these saved states instead
 *   of performing a live login, eliminating Firebase Auth rate-limiting that
 *   caused ~100 cascading 15-second timeouts per run.
 *
 * Data seeding flow:
 *   Creates a known E2E dataset in Firestore using the Firebase Admin SDK
 *   (bypasses security rules — correct for seeding).  All seeded documents are
 *   tagged with `isE2eData: true` so global-teardown.ts can find and delete them.
 *
 *   Seeded IDs are written to e2e/.auth/test-data.json and loaded by tests to
 *   eliminate all hardcoded "Sharks" team references.
 *
 *   Seeding is idempotent — if a complete dataset already exists it is reused.
 *   If only some documents exist (partial run) the missing ones are created.
 *
 * Firebase Admin credentials:
 *   The Admin SDK picks up credentials from GOOGLE_APPLICATION_CREDENTIALS (path
 *   to a service account JSON file).  In CI, decode E2E_FIREBASE_SERVICE_ACCOUNT_JSON
 *   (base64) to /tmp/sa.json and set GOOGLE_APPLICATION_CREDENTIALS=/tmp/sa.json
 *   before the test step.
 *
 * IMPORTANT: e2e/.auth/ is in .gitignore — never commit these files.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const authDir = path.join(__dirname, '.auth');

// ---------------------------------------------------------------------------
// Role auth setup
// ---------------------------------------------------------------------------

interface RoleCredentials {
  role: string;
  emailVar: string;
  passwordVar: string;
}

const ROLES: RoleCredentials[] = [
  { role: 'admin', emailVar: 'E2E_ADMIN_EMAIL', passwordVar: 'E2E_ADMIN_PASSWORD' },
  { role: 'parent', emailVar: 'E2E_PARENT_EMAIL', passwordVar: 'E2E_PARENT_PASSWORD' },
  { role: 'player', emailVar: 'E2E_PLAYER_EMAIL', passwordVar: 'E2E_PLAYER_PASSWORD' },
  { role: 'coach', emailVar: 'E2E_COACH_EMAIL', passwordVar: 'E2E_COACH_PASSWORD' },
  { role: 'lm', emailVar: 'E2E_LM_EMAIL', passwordVar: 'E2E_LM_PASSWORD' },
];

async function loginRole(
  email: string,
  password: string,
  statePath: string,
): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  try {
    await page.goto('/login');

    // Fill in credentials
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password').first().fill(password);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Wait for navigation away from /login — succeeds for any post-login screen
    // (main app, forced password change, consent modal, etc.)
    await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 30_000 });

    // Persist the session
    await context.storageState({ path: statePath });
  } finally {
    await context.close();
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Firebase Admin SDK initialisation
// ---------------------------------------------------------------------------

/**
 * Initialises the Firebase Admin SDK exactly once.
 * Returns null (with a warning) if GOOGLE_APPLICATION_CREDENTIALS is not set,
 * allowing the rest of global-setup (auth login) to proceed without crashing.
 */
function initAdmin(): ReturnType<typeof getFirestore> | null {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.warn(
      '[global-setup] GOOGLE_APPLICATION_CREDENTIALS not set — ' +
        'skipping Firestore data seeding. Tests that depend on seeded data will skip.',
    );
    return null;
  }

  try {
    if (getApps().length === 0) {
      initializeApp({
        credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      });
    }
    return getFirestore();
  } catch (err) {
    console.error('[global-setup] Failed to initialise Firebase Admin SDK —', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Test data seeding
// ---------------------------------------------------------------------------

export interface TestData {
  leagueId: string;
  seasonId: string;
  teamAId: string;
  teamBId: string;
  eventId: string;
  venueId: string;
  teamAName: string;
  teamBName: string;
}

const TEAM_A_NAME = 'E2E Team A';
const TEAM_B_NAME = 'E2E Team B';
const LEAGUE_NAME = 'E2E Test League';

/**
 * Returns yesterday's date in 'YYYY-MM-DD' format so the seeded game is always
 * past-dated, making the "Submit Result" section visible for the coach.
 */
function yesterdayDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Queries a collection for the first document tagged isE2eData: true.
 * Returns the document snapshot or null.
 */
async function findE2eDoc(
  db: ReturnType<typeof getFirestore>,
  collection: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const snap = await db.collection(collection).where('isE2eData', '==', true).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

/**
 * Queries the seasons subcollection of a league for the first isE2eData season.
 */
async function findE2eSeason(
  db: ReturnType<typeof getFirestore>,
  leagueId: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const snap = await db
    .collection('leagues')
    .doc(leagueId)
    .collection('seasons')
    .where('isE2eData', '==', true)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

/**
 * Seeds the E2E test dataset.  Idempotent — existing complete data is reused.
 * Writes the resulting IDs to e2e/.auth/test-data.json.
 */
async function seedTestData(db: ReturnType<typeof getFirestore>): Promise<void> {
  console.log('[global-setup] Checking for existing E2E seed data...');

  const year = new Date().getFullYear();

  // ── 1. League ────────────────────────────────────────────────────────────
  const leagueDoc = await findE2eDoc(db, 'leagues');
  let leagueId: string;

  if (leagueDoc) {
    leagueId = leagueDoc.id;
    console.log(`[global-setup] Reusing existing E2E league: ${leagueId}`);
  } else {
    const leagueRef = db.collection('leagues').doc();
    leagueId = leagueRef.id;
    await leagueRef.set({
      name: LEAGUE_NAME,
      isE2eData: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`[global-setup] Created E2E league: ${leagueId}`);
  }

  // ── 2. Venue ─────────────────────────────────────────────────────────────
  const venueDoc = await findE2eDoc(db, 'venues');
  let venueId: string;

  if (venueDoc) {
    venueId = venueDoc.id;
    console.log(`[global-setup] Reusing existing E2E venue: ${venueId}`);
  } else {
    const venueRef = db.collection('venues').doc();
    venueId = venueRef.id;
    await venueRef.set({
      name: 'E2E Test Venue',
      address: '123 Test Street, Test City',
      isOutdoor: true,
      fields: [],
      ownerUid: 'e2e-seed',
      isE2eData: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`[global-setup] Created E2E venue: ${venueId}`);
  }

  // ── 3. Resolve coach UID from E2E_COACH_EMAIL ────────────────────────────
  let coachUid = 'e2e-coach-placeholder';
  const coachEmail = process.env.E2E_COACH_EMAIL;

  if (coachEmail) {
    try {
      const authAdmin = getAuth();
      const userRecord = await authAdmin.getUserByEmail(coachEmail);
      coachUid = userRecord.uid;
      console.log(`[global-setup] Resolved coach UID: ${coachUid} (${coachEmail})`);
    } catch (err) {
      console.warn(
        `[global-setup] Could not resolve UID for ${coachEmail} — using placeholder. ` +
          'The coach account may not exist in this Firebase project.',
        err,
      );
    }
  } else {
    console.warn('[global-setup] E2E_COACH_EMAIL not set — using placeholder coachUid');
  }

  // ── 4. Team A (home team — coach's team) ─────────────────────────────────
  const teamsSnap = await db
    .collection('teams')
    .where('isE2eData', '==', true)
    .get();

  const existingTeamA = teamsSnap.docs.find(d => d.data().name === TEAM_A_NAME) ?? null;
  const existingTeamB = teamsSnap.docs.find(d => d.data().name === TEAM_B_NAME) ?? null;

  let teamAId: string;
  let teamBId: string;

  if (existingTeamA) {
    teamAId = existingTeamA.id;
    console.log(`[global-setup] Reusing existing E2E Team A: ${teamAId}`);
  } else {
    const teamARef = db.collection('teams').doc();
    teamAId = teamARef.id;
    await teamARef.set({
      name: TEAM_A_NAME,
      coachId: coachUid,
      coachIds: [coachUid],
      leagueIds: [leagueId],
      homeVenueId: venueId,
      sportType: 'soccer',
      color: '#3B82F6',
      createdBy: coachUid,
      ownerName: 'E2E Coach',
      isE2eData: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`[global-setup] Created E2E Team A: ${teamAId}`);
  }

  if (existingTeamB) {
    teamBId = existingTeamB.id;
    console.log(`[global-setup] Reusing existing E2E Team B: ${teamBId}`);
  } else {
    const teamBRef = db.collection('teams').doc();
    teamBId = teamBRef.id;
    await teamBRef.set({
      name: TEAM_B_NAME,
      coachIds: [],
      leagueIds: [leagueId],
      sportType: 'soccer',
      color: '#EF4444',
      createdBy: 'e2e-seed',
      ownerName: 'E2E Seed',
      isE2eData: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`[global-setup] Created E2E Team B: ${teamBId}`);
  }

  // ── 4b. Link parent + player accounts to Team A ──────────────────────────
  // Parent/player profiles need teamId set so the frontend resolves their team
  // context. Without this, /parent shows empty state and cross-role tests fail.
  // Uses merge: true to avoid overwriting other profile fields.
  const accountsToLink: Array<{ envVar: string; role: string }> = [
    { envVar: 'E2E_PARENT_EMAIL', role: 'parent' },
    { envVar: 'E2E_PLAYER_EMAIL', role: 'player' },
  ];

  for (const { envVar, role } of accountsToLink) {
    const email = process.env[envVar];
    if (!email) {
      console.warn(`[global-setup] ${envVar} not set — skipping ${role} team linkage`);
      continue;
    }
    try {
      const userRecord = await getAuth().getUserByEmail(email);
      await db.collection('users').doc(userRecord.uid).set(
        { teamId: teamAId, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      console.log(`[global-setup] Linked ${role} (${userRecord.uid}) → Team A: ${teamAId}`);
    } catch (err) {
      console.warn(`[global-setup] Could not link ${role} account to team —`, err);
    }
  }

  // ── 4c. Seed consent records for all E2E accounts ────────────────────────
  // ConsentUpdateModal (fixed z-50 overlay) renders on every page when
  // users/{uid}/consents/{termsOfService,privacyPolicy} docs are missing or
  // have a version != LEGAL_VERSIONS. That modal blocks pointer events and
  // fails ~80 tests at 15s action timeout. Seed current-version consents
  // for every E2E role so the modal never appears.
  // Keep this in sync with src/legal/versions.ts (LEGAL_VERSIONS).
  const CONSENT_VERSION = '1.0';
  const consentAccounts: Array<{ envVar: string; role: string }> = [
    { envVar: 'E2E_ADMIN_EMAIL', role: 'admin' },
    { envVar: 'E2E_COACH_EMAIL', role: 'coach' },
    { envVar: 'E2E_PARENT_EMAIL', role: 'parent' },
    { envVar: 'E2E_PLAYER_EMAIL', role: 'player' },
    { envVar: 'E2E_LM_EMAIL', role: 'lm' },
  ];

  for (const { envVar, role } of consentAccounts) {
    const rawEmail = process.env[envVar];
    if (!rawEmail) {
      console.warn(`[global-setup] ${envVar} not set — skipping ${role} consent seeding`);
      continue;
    }
    const email = rawEmail.trim().toLowerCase();
    try {
      const userRecord = await getAuth().getUserByEmail(email);
      const agreedAt = new Date().toISOString();
      await Promise.all([
        db.doc(`users/${userRecord.uid}/consents/termsOfService`).set({
          version: CONSENT_VERSION,
          agreedAt,
        }),
        db.doc(`users/${userRecord.uid}/consents/privacyPolicy`).set({
          version: CONSENT_VERSION,
          agreedAt,
        }),
      ]);
      console.log(`[global-setup] Seeded consents for ${role} (${userRecord.uid})`);
    } catch (err) {
      console.warn(`[global-setup] Could not seed consents for ${role} —`, err);
    }
  }

  // ── 4d. Reset createTeam rate-limit counter for admin E2E account ────────
  // Each admin.spec.ts run creates up to 4 teams. The CF rate limit is 20 per
  // 60s window (raised from 5 to accommodate real-user bulk paths). If CI
  // retries or rapid re-runs occur within the same window, the counter can
  // still accumulate across runs. Resetting at setup start ensures each run
  // always starts from 0 regardless of prior runs within the window.
  const adminEmailRaw = process.env.E2E_ADMIN_EMAIL;
  if (adminEmailRaw) {
    const adminEmail = adminEmailRaw.trim().toLowerCase();
    try {
      const adminRecord = await getAuth().getUserByEmail(adminEmail);
      await db.doc(`rateLimits/${adminRecord.uid}_createTeam`).delete();
      console.log(`[global-setup] Reset createTeam rate-limit for admin (${adminRecord.uid})`);
    } catch (err) {
      console.warn('[global-setup] Could not reset admin createTeam rate-limit —', err);
    }
  }

  // ── 5. Season (subcollection of league) ──────────────────────────────────
  const seasonDoc = await findE2eSeason(db, leagueId);
  let seasonId: string;

  if (seasonDoc) {
    seasonId = seasonDoc.id;
    console.log(`[global-setup] Reusing existing E2E season: ${seasonId}`);
  } else {
    const seasonRef = db.collection('leagues').doc(leagueId).collection('seasons').doc();
    seasonId = seasonRef.id;
    await seasonRef.set({
      name: `E2E Season ${year}`,
      leagueId,
      teamIds: [teamAId, teamBId],
      isE2eData: true,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      status: 'active',
      gamesPerTeam: 1,
      homeAwayBalance: true,
      createdBy: 'e2e-seed',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`[global-setup] Created E2E season: ${seasonId}`);
  }

  // ── 6. Event (past-dated game — "Submit Result" section appears for coach) ─
  const eventDoc = await findE2eDoc(db, 'events');
  let eventId: string;

  if (eventDoc) {
    eventId = eventDoc.id;
    // Check whether the event is still past-dated (it should be, but re-verify)
    const eventData = eventDoc.data();
    const existingDate: string = eventData.date ?? '';
    const today = new Date().toISOString().slice(0, 10);
    if (existingDate >= today) {
      // The date was somehow set to today or future — patch it to yesterday
      const yesterday = yesterdayDateString();
      await eventDoc.ref.update({ date: yesterday, updatedAt: FieldValue.serverTimestamp() });
      console.log(`[global-setup] Patched E2E event date to yesterday: ${yesterday}`);
    } else {
      console.log(`[global-setup] Reusing existing E2E event: ${eventId}`);
    }
  } else {
    const eventRef = db.collection('events').doc();
    eventId = eventRef.id;
    await eventRef.set({
      title: 'E2E Test Game',
      type: 'game',
      teamIds: [teamAId, teamBId],
      homeTeamId: teamAId,
      awayTeamId: teamBId,
      leagueId,
      seasonId,
      venueId,
      date: yesterdayDateString(),
      startTime: '10:00',
      endTime: '11:30',
      status: 'published',
      isRecurring: false,
      isE2eData: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`[global-setup] Created E2E event: ${eventId}`);
  }

  // ── 7. Write test-data.json ───────────────────────────────────────────────
  const testData: TestData = {
    leagueId,
    seasonId,
    teamAId,
    teamBId,
    eventId,
    venueId,
    teamAName: TEAM_A_NAME,
    teamBName: TEAM_B_NAME,
  };

  const testDataPath = path.join(authDir, 'test-data.json');
  fs.writeFileSync(testDataPath, JSON.stringify(testData, null, 2));
  console.log(`[global-setup] Seed data written to ${testDataPath}`);
}

// ---------------------------------------------------------------------------
// Global setup entry point
// ---------------------------------------------------------------------------

async function globalSetup(): Promise<void> {
  // Ensure the .auth directory exists
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  // ── Step 1: Authenticate all roles ───────────────────────────────────────
  for (const { role, emailVar, passwordVar } of ROLES) {
    const email = process.env[emailVar];
    const password = process.env[passwordVar];

    if (!email || !password) {
      // Missing creds for this role — skip (tests that need it will skip themselves)
      console.warn(
        `[global-setup] Skipping ${role}: ${emailVar} or ${passwordVar} not set.`,
      );
      continue;
    }

    const statePath = path.join(authDir, `${role}.json`);
    console.log(`[global-setup] Logging in as ${role} (${email})...`);

    try {
      await loginRole(email, password, statePath);
      console.log(`[global-setup] ${role}: storageState saved to ${statePath}`);
    } catch (err) {
      console.error(`[global-setup] ${role}: login failed —`, err);
      // Rethrow so CI fails loudly rather than silently producing bad state files
      throw err;
    }
  }

  // ── Step 2: Seed Firestore test data ──────────────────────────────────────
  const db = initAdmin();
  if (db) {
    try {
      await seedTestData(db);
    } catch (err) {
      // Seed failure is non-fatal: log loudly and write an empty test-data.json
      // so tests can detect the missing data and skip gracefully.
      console.error('[global-setup] Firestore seeding failed —', err);
      const testDataPath = path.join(authDir, 'test-data.json');
      fs.writeFileSync(testDataPath, JSON.stringify({}, null, 2));
    }
  } else {
    // No Admin SDK credentials — write an empty test-data.json so tests can skip gracefully
    const testDataPath = path.join(authDir, 'test-data.json');
    if (!fs.existsSync(testDataPath)) {
      fs.writeFileSync(testDataPath, JSON.stringify({}, null, 2));
    }
  }

  // ── Step 3: Warm up createTeamAndBecomeCoach Cloud Function ──────────────
  // This CF has a 15-20s cold start in CI. Pinging it here with an intentionally
  // invalid payload (returns 401 immediately) warms the container so tests that
  // call it via the UI don't time out waiting for the first real invocation.
  const functionsBase =
    process.env.E2E_FUNCTIONS_BASE ??
    'https://us-central1-first-whistle-e76f4.cloudfunctions.net';
  try {
    const warmupUrl = `${functionsBase}/createTeamAndBecomeCoach`;
    const res = await fetch(warmupUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: {} }),
      signal: AbortSignal.timeout(30_000),
    });
    console.log(`[global-setup] CF warmup ping → HTTP ${res.status} (container is warm)`);
  } catch (err) {
    // Non-fatal: warmup best-effort only. Tests may still hit cold starts.
    console.warn('[global-setup] CF warmup ping failed (non-fatal) —', (err as Error).message);
  }
}

export default globalSetup;
