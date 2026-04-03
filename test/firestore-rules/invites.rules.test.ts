/**
 * Firestore security rules tests — /invites/{inviteId}
 *
 * These tests run against the real Firebase Emulator Suite.
 * Do NOT mock Firestore — mock/prod divergence has caused production incidents
 * on this project (see QA institutional knowledge).
 *
 * Prerequisites:
 *   firebase emulators:start --only firestore
 *
 * Run:
 *   npm run test:rules
 *
 * Rule under test (firestore.rules ~line 308):
 *
 *   match /invites/{inviteId} {
 *     allow read: if request.auth != null && (
 *       isAdmin() || isCoach() || isLeagueManager() ||
 *       request.auth.token.email == resource.data.email
 *     );
 *     allow delete: if request.auth != null &&
 *       request.auth.token.email == resource.data.email;
 *     allow create, update: if false;
 *   }
 *
 * Test cases:
 *   1. Invitee (email match) can delete their own invite
 *   2. Non-invitee authenticated user cannot delete another user's invite
 *   3. Unauthenticated caller cannot delete any invite
 *   4. Authenticated user cannot create an invite (create is locked to Admin SDK)
 *   5. Authenticated user cannot update an invite (update is locked to Admin SDK)
 *   6. Invitee can read their own invite (email claim match)
 *   7. Authenticated non-invitee without elevated role cannot read another user's invite
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  doc,
  getDoc,
  deleteDoc,
  setDoc,
} from 'firebase/firestore';

// ── Constants ─────────────────────────────────────────────────────────────────

const PROJECT_ID = 'demo-first-whistle-rules-test';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8080;

// Path to the actual rules file — resolved from repo root so this test always
// runs against the same file that will be deployed.
const RULES_PATH = resolve(
  new URL('.', import.meta.url).pathname,
  '../../firestore.rules'
);

// ── Test environment lifecycle ────────────────────────────────────────────────

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: FIRESTORE_HOST,
      port: FIRESTORE_PORT,
      rules: readFileSync(RULES_PATH, 'utf8'),
    },
  });
});

afterEach(async () => {
  // Wipe Firestore data between tests so each test is fully independent.
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

// ── Helper: seed an invite document via the Admin bypass ─────────────────────

/**
 * Writes an invite document to the emulator as if the Admin SDK wrote it,
 * bypassing security rules. This is how invites are created in production
 * (Cloud Function only), so this correctly represents the starting state
 * for all delete/read tests.
 */
async function seedInvite(
  inviteId: string,
  data: { email: string; teamId?: string; playerId?: string; role?: string }
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'invites', inviteId), data);
  });
}

/**
 * Seeds a user profile document (needed so isAdmin()/isCoach()/isLeagueManager()
 * helper functions can resolve the role via get()). Without this seed, any rule
 * that calls getProfile() will throw a "missing document" error in the emulator
 * and evaluate to false rather than the expected result.
 */
async function seedUserProfile(
  uid: string,
  role: 'player' | 'coach' | 'admin' | 'league_manager' | 'parent'
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', uid), {
      uid,
      email: `${uid}@test.example`,
      displayName: uid,
      role,
      createdAt: new Date().toISOString(),
    });
  });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Firestore rules — /invites/{inviteId}', () => {

  // ── DELETE ──────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('allows delete when the authenticated user email matches the invite email', async () => {
      // Arrange
      const inviteId = 'alice@example.com';
      await seedInvite(inviteId, { email: 'alice@example.com', teamId: 'team-1', playerId: 'player-1' });
      await seedUserProfile('alice-uid', 'player');

      // Act — authenticate as alice; her token.email matches resource.data.email
      const aliceCtx = testEnv.authenticatedContext('alice-uid', {
        email: 'alice@example.com',
        email_verified: true,
      });
      const inviteRef = doc(aliceCtx.firestore(), 'invites', inviteId);

      // Assert
      await assertSucceeds(deleteDoc(inviteRef));
    });

    it('denies delete when the authenticated user email does NOT match the invite email', async () => {
      // Arrange
      const inviteId = 'alice@example.com';
      await seedInvite(inviteId, { email: 'alice@example.com', teamId: 'team-1', playerId: 'player-1' });
      await seedUserProfile('bob-uid', 'player');

      // Act — bob is authenticated but his email is different
      const bobCtx = testEnv.authenticatedContext('bob-uid', {
        email: 'bob@example.com',
        email_verified: true,
      });
      const inviteRef = doc(bobCtx.firestore(), 'invites', inviteId);

      // Assert
      await assertFails(deleteDoc(inviteRef));
    });

    it('denies delete for an unauthenticated caller', async () => {
      // Arrange
      const inviteId = 'alice@example.com';
      await seedInvite(inviteId, { email: 'alice@example.com', teamId: 'team-1', playerId: 'player-1' });

      // Act — no auth context
      const unauthCtx = testEnv.unauthenticatedContext();
      const inviteRef = doc(unauthCtx.firestore(), 'invites', inviteId);

      // Assert
      await assertFails(deleteDoc(inviteRef));
    });
  });

  // ── CREATE / UPDATE ─────────────────────────────────────────────────────────

  describe('create', () => {
    it('denies create from any authenticated client — invites are Admin SDK only', async () => {
      // Arrange — no pre-existing invite; user tries to create one
      await seedUserProfile('coach-uid', 'coach');

      // Act — even a coach cannot create an invite through the client SDK
      const coachCtx = testEnv.authenticatedContext('coach-uid', {
        email: 'coach@example.com',
        email_verified: true,
      });
      const newInviteRef = doc(coachCtx.firestore(), 'invites', 'newplayer@example.com');

      // Assert
      await assertFails(
        setDoc(newInviteRef, {
          email: 'newplayer@example.com',
          teamId: 'team-1',
          playerId: 'player-2',
        })
      );
    });
  });

  describe('update', () => {
    it('denies update from any authenticated client — invites are Admin SDK only', async () => {
      // Arrange — seed an invite that already exists
      const inviteId = 'alice@example.com';
      await seedInvite(inviteId, { email: 'alice@example.com', teamId: 'team-1', playerId: 'player-1' });
      await seedUserProfile('alice-uid', 'player');

      // Act — even the invitee (email owner) cannot update the invite
      const aliceCtx = testEnv.authenticatedContext('alice-uid', {
        email: 'alice@example.com',
        email_verified: true,
      });
      const inviteRef = doc(aliceCtx.firestore(), 'invites', inviteId);

      // Assert — setDoc with merge behaves as an update when the doc exists
      await assertFails(
        setDoc(inviteRef, { role: 'admin' }, { merge: true })
      );
    });
  });

  // ── READ ────────────────────────────────────────────────────────────────────

  describe('read', () => {
    it('allows read when the authenticated user email matches the invite email', async () => {
      // Arrange
      const inviteId = 'alice@example.com';
      await seedInvite(inviteId, { email: 'alice@example.com', teamId: 'team-1', playerId: 'player-1' });
      await seedUserProfile('alice-uid', 'player');

      // Act
      const aliceCtx = testEnv.authenticatedContext('alice-uid', {
        email: 'alice@example.com',
        email_verified: true,
      });
      const inviteRef = doc(aliceCtx.firestore(), 'invites', inviteId);

      // Assert
      await assertSucceeds(getDoc(inviteRef));
    });

    it('denies read for a non-invitee authenticated user without an elevated role', async () => {
      // Arrange — bob is authenticated as a plain 'player'; he cannot read alice's invite
      const inviteId = 'alice@example.com';
      await seedInvite(inviteId, { email: 'alice@example.com', teamId: 'team-1', playerId: 'player-1' });
      await seedUserProfile('bob-uid', 'player');

      // Act
      const bobCtx = testEnv.authenticatedContext('bob-uid', {
        email: 'bob@example.com',
        email_verified: true,
      });
      const inviteRef = doc(bobCtx.firestore(), 'invites', inviteId);

      // Assert
      await assertFails(getDoc(inviteRef));
    });
  });

});
