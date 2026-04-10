// @vitest-environment node
/**
 * Player roster — emulator integration test
 *
 * Tests the exact failure scenario that caused "player added but never appears":
 *   1. Coach writes a player doc (verifies create rule passes)
 *   2. Filtered query where('teamId','==',X) + orderBy('createdAt') returns the doc
 *      (verifies read rule passes for the coach's team-scoped query)
 *   3. Coach on a DIFFERENT team cannot read the player (verifies team isolation)
 *   4. sensitiveData subcollection is readable by coach of same team only
 *
 * Runs against the Firestore emulator — no index enforcement, but full rule enforcement.
 * The composite index (teamId + createdAt) is verified to exist in firestore.indexes.json
 * by a separate assertion at the bottom of this file.
 *
 * Prereq: firebase emulators:start --only firestore,auth --project demo-test
 */

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

// ── Load actual rules from disk ───────────────────────────────────────────────

const RULES_PATH = resolve(__dirname, '../../firestore.rules');
const rules = readFileSync(RULES_PATH, 'utf8');

const INDEXES_PATH = resolve(__dirname, '../../firestore.indexes.json');
const indexes = JSON.parse(readFileSync(INDEXES_PATH, 'utf8'));

// ── Constants ──────────────────────────────────────────────────────────────────

const PROJECT_ID = 'demo-test';
const COACH_UID = 'coach-uid-001';
const OTHER_COACH_UID = 'coach-uid-002';
const TEAM_ID = 'team-alpha';
const OTHER_TEAM_ID = 'team-beta';
const PLAYER_ID = 'player-001';

// ── Test environment ───────────────────────────────────────────────────────────

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

// ── Seed helpers ───────────────────────────────────────────────────────────────

/** Write docs bypassing rules — for seeding prerequisite data. */
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // Coach profile (role required for isCoach() helper in rules)
    await db.doc(`users/${COACH_UID}`).set({
      uid: COACH_UID,
      role: 'coach',
      displayName: 'Test Coach',
      teamId: TEAM_ID,
    });

    // Other coach profile
    await db.doc(`users/${OTHER_COACH_UID}`).set({
      uid: OTHER_COACH_UID,
      role: 'coach',
      displayName: 'Other Coach',
      teamId: OTHER_TEAM_ID,
    });

    // Team with coachId + coachIds populated (as createTeamAndBecomeCoach CF does)
    await db.doc(`teams/${TEAM_ID}`).set({
      id: TEAM_ID,
      name: 'Team Alpha',
      coachId: COACH_UID,
      coachIds: [COACH_UID],
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    // Other team — other coach's team
    await db.doc(`teams/${OTHER_TEAM_ID}`).set({
      id: OTHER_TEAM_ID,
      name: 'Team Beta',
      coachId: OTHER_COACH_UID,
      coachIds: [OTHER_COACH_UID],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Player roster — emulator integration', () => {

  // ── 1. Coach can create a player on their team ───────────────────────────────

  it('coach can write a player to their team', async () => {
    await seed();

    const coach = testEnv.authenticatedContext(COACH_UID, { email: 'coach@test.com' });
    const db = coach.firestore();

    await assertSucceeds(
      setDoc(doc(db, 'players', PLAYER_ID), {
        id: PLAYER_ID,
        teamId: TEAM_ID,
        firstName: 'Alex',
        lastName: 'Smith',
        status: 'active',
        createdAt: '2026-04-10T12:00:00.000Z',
        updatedAt: '2026-04-10T12:00:00.000Z',
      }),
    );
  });

  // ── 2. Coach can read that player back (document read) ───────────────────────

  it('coach can read a player on their team', async () => {
    await seed();

    // Seed the player doc via admin
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`players/${PLAYER_ID}`).set({
        id: PLAYER_ID,
        teamId: TEAM_ID,
        firstName: 'Alex',
        lastName: 'Smith',
        status: 'active',
        createdAt: '2026-04-10T12:00:00.000Z',
        updatedAt: '2026-04-10T12:00:00.000Z',
      });
    });

    const coach = testEnv.authenticatedContext(COACH_UID);
    const db = coach.firestore();

    const snap = await assertSucceeds(getDoc(doc(db, 'players', PLAYER_ID)));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.firstName).toBe('Alex');
  });

  // ── 3. Core regression: filtered query returns the player ────────────────────
  //
  // This is the exact query usePlayerStore.subscribe() runs for non-admin roles.
  // Before the composite index was added this query would fail in production
  // (emulator doesn't enforce indexes but DOES enforce rules).

  it('filtered query where(teamId) + orderBy(createdAt) returns player', async () => {
    await seed();

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`players/${PLAYER_ID}`).set({
        id: PLAYER_ID,
        teamId: TEAM_ID,
        firstName: 'Alex',
        lastName: 'Smith',
        status: 'active',
        createdAt: '2026-04-10T12:00:00.000Z',
        updatedAt: '2026-04-10T12:00:00.000Z',
      });
    });

    const coach = testEnv.authenticatedContext(COACH_UID);
    const db = coach.firestore();

    const q = query(
      collection(db, 'players'),
      where('teamId', '==', TEAM_ID),
      orderBy('createdAt'),
    );

    const snap = await assertSucceeds(getDocs(q));
    expect(snap.docs).toHaveLength(1);
    expect(snap.docs[0].data().firstName).toBe('Alex');
  });

  // ── 4. Team isolation: other coach cannot read via the same filtered query ───

  it('other team coach cannot read players via filtered query', async () => {
    await seed();

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`players/${PLAYER_ID}`).set({
        id: PLAYER_ID,
        teamId: TEAM_ID,
        firstName: 'Alex',
        lastName: 'Smith',
        status: 'active',
        createdAt: '2026-04-10T12:00:00.000Z',
        updatedAt: '2026-04-10T12:00:00.000Z',
      });
    });

    const otherCoach = testEnv.authenticatedContext(OTHER_COACH_UID);
    const db = otherCoach.firestore();

    // Query scoped to OTHER coach's team — should return nothing, not error
    const q = query(
      collection(db, 'players'),
      where('teamId', '==', OTHER_TEAM_ID),
      orderBy('createdAt'),
    );

    // Empty result (no players on other team), NOT a permission error
    const snap = await assertSucceeds(getDocs(q));
    expect(snap.docs).toHaveLength(0);

    // Direct read of the player (wrong team) must fail
    await assertFails(getDoc(doc(db, 'players', PLAYER_ID)));
  });

  // ── 5. sensitiveData subcollection: coach can read, other coach cannot ───────

  it('coach can read sensitiveData on their team player', async () => {
    await seed();

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      await adminDb.doc(`players/${PLAYER_ID}`).set({
        id: PLAYER_ID,
        teamId: TEAM_ID,
        firstName: 'Alex',
        lastName: 'Smith',
        status: 'active',
        createdAt: '2026-04-10T12:00:00.000Z',
        updatedAt: '2026-04-10T12:00:00.000Z',
      });
      await adminDb.doc(`players/${PLAYER_ID}/sensitiveData/private`).set({
        playerId: PLAYER_ID,
        teamId: TEAM_ID,
        dateOfBirth: '2015-06-15',
      });
    });

    const coach = testEnv.authenticatedContext(COACH_UID);
    const snap = await assertSucceeds(
      getDoc(doc(coach.firestore(), `players/${PLAYER_ID}/sensitiveData/private`)),
    );
    expect(snap.data()?.dateOfBirth).toBe('2015-06-15');
  });

  it('other team coach cannot read sensitiveData', async () => {
    await seed();

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      await adminDb.doc(`players/${PLAYER_ID}`).set({
        id: PLAYER_ID,
        teamId: TEAM_ID,
        firstName: 'Alex',
        lastName: 'Smith',
        status: 'active',
        createdAt: '2026-04-10T12:00:00.000Z',
        updatedAt: '2026-04-10T12:00:00.000Z',
      });
      await adminDb.doc(`players/${PLAYER_ID}/sensitiveData/private`).set({
        playerId: PLAYER_ID,
        teamId: TEAM_ID,
        dateOfBirth: '2015-06-15',
      });
    });

    const otherCoach = testEnv.authenticatedContext(OTHER_COACH_UID);
    await assertFails(
      getDoc(doc(otherCoach.firestore(), `players/${PLAYER_ID}/sensitiveData/private`)),
    );
  });

  // ── 6. Full add-then-read flow (mirrors handleSubmit in PlayerForm) ──────────

  it('coach writes player then reads it back via filtered query (end-to-end flow)', async () => {
    await seed();

    const coach = testEnv.authenticatedContext(COACH_UID);
    const db = coach.firestore();

    // Step 1: addPlayer (what PlayerForm calls)
    await assertSucceeds(
      setDoc(doc(db, 'players', PLAYER_ID), {
        id: PLAYER_ID,
        teamId: TEAM_ID,
        firstName: 'Jordan',
        lastName: 'Taylor',
        status: 'active',
        createdAt: '2026-04-10T12:00:00.000Z',
        updatedAt: '2026-04-10T12:00:00.000Z',
      }),
    );

    // Step 2: addSensitiveData
    await assertSucceeds(
      setDoc(doc(db, `players/${PLAYER_ID}/sensitiveData/private`), {
        playerId: PLAYER_ID,
        teamId: TEAM_ID,
        dateOfBirth: '2014-03-22',
      }),
    );

    // Step 3: subscription query (what usePlayerStore.subscribe() runs)
    const q = query(
      collection(db, 'players'),
      where('teamId', '==', TEAM_ID),
      orderBy('createdAt'),
    );
    const snap = await assertSucceeds(getDocs(q));
    expect(snap.docs).toHaveLength(1);
    expect(snap.docs[0].data().firstName).toBe('Jordan');
  });
});

// ── Static: verify composite index exists in firestore.indexes.json ───────────

describe('firestore.indexes.json — composite index coverage', () => {
  it('has players/teamId+createdAt composite index (required for filtered subscription query)', () => {
    const playersIndex = indexes.indexes.find(
      (idx: { collectionGroup: string; fields: Array<{ fieldPath: string }> }) =>
        idx.collectionGroup === 'players' &&
        idx.fields.some((f: { fieldPath: string }) => f.fieldPath === 'teamId') &&
        idx.fields.some((f: { fieldPath: string }) => f.fieldPath === 'createdAt'),
    );
    expect(
      playersIndex,
      'Missing players/teamId+createdAt composite index — this causes silent query failure for non-admin users',
    ).toBeDefined();
  });
});
