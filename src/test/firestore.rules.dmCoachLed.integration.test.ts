// @vitest-environment node
/**
 * Firestore security rules — dmThreads: SEC-71 coach-led DM enforcement
 *
 * PR #665 (commit c7462b0) introduced coach-led DMs. The dmThreads `create`
 * rule requires:
 *   1. Caller is a participant (request.resource.data.participants.hasAny([uid]))
 *   2. Exactly 2 participants
 *   3. teamId is a non-empty string
 *   4. The referenced team doc EXISTS in Firestore
 *   5. get(teams/teamId).data.get('coachIds', []).hasAny(participants)
 *      — at least one participant must appear in the team's coachIds array
 *
 * The `update` rule locks teamId via an affectedKeys allowlist:
 *   affectedKeys.hasOnly(['lastMessage', 'lastMessageAt', 'updatedAt', 'participantNames'])
 * teamId is NOT in the allowlist, so any write that changes it (appearing in
 * affectedKeys) is denied.
 *
 * Prerequisite: Firestore emulator running on 127.0.0.1:8080
 *   firebase emulators:start --only firestore --project demo-test
 *
 * Run command (from project root):
 *   firebase emulators:exec --only firestore \
 *     "npx vitest run src/test/firestore.rules.dmCoachLed.integration.test.ts" \
 *     --project demo-test
 */

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { describe, it, beforeAll, afterAll, afterEach } from 'vitest';

// ── Load actual rules from disk ───────────────────────────────────────────────

const RULES_PATH = resolve(__dirname, '../../firestore.rules');
const rules = readFileSync(RULES_PATH, 'utf8');

// ── Constants ─────────────────────────────────────────────────────────────────

const PROJECT_ID = 'demo-test';

// Users
const COACH_UID = 'coach-uid-sec71';
const PARENT_UID = 'parent-uid-sec71';
const PARENT_B_UID = 'parent-b-uid-sec71';
const STRANGER_UID = 'stranger-uid-sec71';

// Team
const TEAM_ID = 'team-sec71';
const UNRELATED_TEAM_ID = 'team-unrelated-sec71';

// Thread IDs (sorted UID_UID convention is just a naming convention — rules
// do not enforce the format, only the participants[] field content)
const COACH_PARENT_THREAD_ID = `${COACH_UID}_${PARENT_UID}`;
const PARENT_PARENT_THREAD_ID = `${PARENT_UID}_${PARENT_B_UID}`;

// ── Test environment ──────────────────────────────────────────────────────────

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

// ── Seed helpers ──────────────────────────────────────────────────────────────

/** Seeds the base team and user profiles needed by coach-led DM tests. */
async function seedTeamAndUsers() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // Primary team — coach is in coachIds
    await db.doc(`teams/${TEAM_ID}`).set({
      id: TEAM_ID,
      name: 'Test Team SEC-71',
      coachId: COACH_UID,
      coachIds: [COACH_UID],
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    // Unrelated team — neither COACH_UID nor PARENT_UID is in coachIds
    await db.doc(`teams/${UNRELATED_TEAM_ID}`).set({
      id: UNRELATED_TEAM_ID,
      name: 'Unrelated Team SEC-71',
      coachId: STRANGER_UID,
      coachIds: [STRANGER_UID],
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    // User profiles (role is read by isCoach/isAdmin helpers in rules)
    await db.doc(`users/${COACH_UID}`).set({
      uid: COACH_UID,
      role: 'coach',
      displayName: 'Coach SEC71',
      teamId: TEAM_ID,
    });

    await db.doc(`users/${PARENT_UID}`).set({
      uid: PARENT_UID,
      role: 'parent',
      displayName: 'Parent A SEC71',
    });

    await db.doc(`users/${PARENT_B_UID}`).set({
      uid: PARENT_B_UID,
      role: 'parent',
      displayName: 'Parent B SEC71',
    });

    await db.doc(`users/${STRANGER_UID}`).set({
      uid: STRANGER_UID,
      role: 'coach',
      displayName: 'Stranger Coach SEC71',
      teamId: UNRELATED_TEAM_ID,
    });
  });
}

/** Seeds a pre-existing dmThread for update tests. */
async function seedExistingThread(
  threadId: string,
  participants: string[],
  teamId: string,
) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`dmThreads/${threadId}`).set({
      participants,
      teamId,
      lastMessage: '',
      lastMessageAt: null,
      updatedAt: null,
      participantNames: {},
    });
  });
}

// =============================================================================
// SEC-71 — dmThreads create
// =============================================================================

describe('SEC-71 — dmThreads create: coach-led enforcement', () => {

  // ── ALLOW: coach↔parent on a shared team ────────────────────────────────────
  //
  // Emulator equivalent:
  //   const db = testEnv.authenticatedContext(COACH_UID).firestore();
  //   await assertSucceeds(setDoc(doc(db, 'dmThreads', COACH_PARENT_THREAD_ID), {
  //     participants: [COACH_UID, PARENT_UID],
  //     teamId: TEAM_ID,
  //     ...
  //   }));

  it('ALLOW: coach↔parent create when coach is in team.coachIds', async () => {
    await seedTeamAndUsers();

    const coachDb = testEnv.authenticatedContext(COACH_UID).firestore();

    await assertSucceeds(
      setDoc(doc(coachDb, 'dmThreads', COACH_PARENT_THREAD_ID), {
        participants: [COACH_UID, PARENT_UID],
        teamId: TEAM_ID,
        lastMessage: '',
        lastMessageAt: null,
        updatedAt: null,
        participantNames: { [COACH_UID]: 'Coach SEC71', [PARENT_UID]: 'Parent A SEC71' },
      }),
    );
  });

  // ── DENY: parent↔parent (no coach in either participant) ────────────────────
  //
  // Both participants are parents — neither appears in team.coachIds — so the
  // rule's `coachIds.hasAny(participants)` check fails.
  //
  // Emulator equivalent:
  //   const db = testEnv.authenticatedContext(PARENT_UID).firestore();
  //   await assertFails(setDoc(doc(db, 'dmThreads', PARENT_PARENT_THREAD_ID), {
  //     participants: [PARENT_UID, PARENT_B_UID],
  //     teamId: TEAM_ID,
  //     ...
  //   }));

  it('DENY: parent↔parent create — neither participant is in team.coachIds', async () => {
    await seedTeamAndUsers();

    const parentDb = testEnv.authenticatedContext(PARENT_UID).firestore();

    await assertFails(
      setDoc(doc(parentDb, 'dmThreads', PARENT_PARENT_THREAD_ID), {
        participants: [PARENT_UID, PARENT_B_UID],
        teamId: TEAM_ID,
        lastMessage: '',
        lastMessageAt: null,
        updatedAt: null,
        participantNames: {},
      }),
    );
  });

  // ── DENY: missing teamId on the dmThread doc ─────────────────────────────────
  //
  // The rule checks `request.resource.data.teamId is string
  //   && request.resource.data.teamId.size() > 0`.
  // Omitting teamId entirely fails the `is string` check.
  //
  // Emulator equivalent:
  //   await assertFails(setDoc(doc(db, 'dmThreads', '...'), {
  //     participants: [COACH_UID, PARENT_UID],
  //     // no teamId field
  //   }));

  it('DENY: create without a teamId field', async () => {
    await seedTeamAndUsers();

    const coachDb = testEnv.authenticatedContext(COACH_UID).firestore();

    await assertFails(
      setDoc(doc(coachDb, 'dmThreads', COACH_PARENT_THREAD_ID), {
        participants: [COACH_UID, PARENT_UID],
        // teamId intentionally omitted
        lastMessage: '',
        lastMessageAt: null,
        updatedAt: null,
        participantNames: {},
      }),
    );
  });

  // ── DENY: teamId points to a team where neither participant is in coachIds ────
  //
  // Both participants exist; the team doc exists; but UNRELATED_TEAM_ID has only
  // STRANGER_UID in coachIds — so `coachIds.hasAny([COACH_UID, PARENT_UID])` is
  // false even though COACH_UID is a coach elsewhere.
  //
  // Emulator equivalent:
  //   await assertFails(setDoc(doc(db, 'dmThreads', COACH_PARENT_THREAD_ID), {
  //     participants: [COACH_UID, PARENT_UID],
  //     teamId: UNRELATED_TEAM_ID,  // ← wrong team
  //     ...
  //   }));

  it('DENY: create with teamId pointing to a team where neither participant is in coachIds', async () => {
    await seedTeamAndUsers();

    const coachDb = testEnv.authenticatedContext(COACH_UID).firestore();

    await assertFails(
      setDoc(doc(coachDb, 'dmThreads', COACH_PARENT_THREAD_ID), {
        participants: [COACH_UID, PARENT_UID],
        teamId: UNRELATED_TEAM_ID,
        lastMessage: '',
        lastMessageAt: null,
        updatedAt: null,
        participantNames: {},
      }),
    );
  });
});

// =============================================================================
// SEC-71 — dmThreads update: teamId immutability
// =============================================================================

describe('SEC-71 — dmThreads update: teamId field must be immutable', () => {

  // ── DENY: teamId mutation on update ─────────────────────────────────────────
  //
  // The update rule allows only:
  //   affectedKeys.hasOnly(['lastMessage', 'lastMessageAt', 'updatedAt', 'participantNames'])
  //
  // teamId is NOT in that allowlist. Writing a different teamId value means
  // teamId appears in affectedKeys → rule denies.
  //
  // Note: The rule comment explains that sendDm's setDoc-merge RE-WRITES the
  // same teamId, which does NOT appear in affectedKeys (no change = not
  // affected). This test writes a DIFFERENT teamId, so it appears in affectedKeys
  // and is correctly denied.
  //
  // Emulator equivalent:
  //   const db = testEnv.authenticatedContext(COACH_UID).firestore();
  //   await assertFails(updateDoc(doc(db, 'dmThreads', threadId), {
  //     teamId: UNRELATED_TEAM_ID,  // ← mutation attempt
  //     lastMessageAt: new Date(),
  //   }));

  it('DENY: update that mutates teamId is rejected', async () => {
    await seedTeamAndUsers();
    await seedExistingThread(
      COACH_PARENT_THREAD_ID,
      [COACH_UID, PARENT_UID],
      TEAM_ID,
    );

    const coachDb = testEnv.authenticatedContext(COACH_UID).firestore();

    await assertFails(
      updateDoc(doc(coachDb, 'dmThreads', COACH_PARENT_THREAD_ID), {
        teamId: UNRELATED_TEAM_ID,
        lastMessageAt: new Date(),
      }),
    );
  });

  // ── ALLOW: update of allowed fields only (control path) ─────────────────────
  //
  // A participant updating only `lastMessage` + `updatedAt` (both in the
  // allowlist) must succeed — confirms the update rule itself is exercised.

  it('ALLOW: participant can update allowed metadata fields (lastMessage, updatedAt)', async () => {
    await seedTeamAndUsers();
    await seedExistingThread(
      COACH_PARENT_THREAD_ID,
      [COACH_UID, PARENT_UID],
      TEAM_ID,
    );

    const coachDb = testEnv.authenticatedContext(COACH_UID).firestore();

    await assertSucceeds(
      updateDoc(doc(coachDb, 'dmThreads', COACH_PARENT_THREAD_ID), {
        lastMessage: 'See you at practice',
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });
});
