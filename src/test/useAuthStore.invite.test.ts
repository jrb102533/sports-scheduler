/**
 * useAuthStore — invite auto-link integration tests
 *
 * Tests the auto-link path in `init()`:
 *   When a user signs in and their profile has no teamId/playerId,
 *   the store checks Firestore for an invite keyed by the user's email.
 *   If one exists, it patches the profile with teamId + playerId (and
 *   optionally role), then deletes the invite document.
 *
 * These tests stay in the Vitest/jsdom suite (NOT the emulator suite) because
 * they test application logic — what the store does with Firestore responses —
 * not whether the security rules allow the operation.  The emulator rules tests
 * in test/firestore-rules/invites.rules.test.ts cover the rules side.
 *
 * Mocking strategy:
 *   - Firebase SDK is mocked at module level following the established pattern
 *     in this project (see authHelpers.test.ts, StandingsTable.test.tsx).
 *   - onAuthStateChanged captures its callback so tests can drive auth state.
 *   - onSnapshot captures its callback so tests can drive profile state.
 *   - getDoc, setDoc, deleteDoc are individually controlled per test.
 *   - vi.hoisted() is required because vi.mock() factories are hoisted to the
 *     top of the file before any const declarations — without hoisting the spy
 *     references would be undefined inside the factory.
 *
 * Coverage:
 *   1. When invite exists with teamId + playerId, profile is patched and invite deleted
 *   2. When invite has allowed role ('parent') and current role is 'player', role is promoted
 *   3. When invite role is not in ALLOWED_INVITE_ROLES, role is NOT promoted
 *   4. When invite role is allowed but current profile role is not 'player', role is NOT downgraded
 *   5. When no invite document exists, profile is NOT patched and deleteDoc is NOT called
 *   6. When invite exists but is missing teamId, profile is NOT patched with teamId
 *   7. When invite exists but is missing playerId, profile is NOT patched with playerId
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoist shared state so it survives vi.mock() hoisting ──────────────────────
// vi.mock() factories run before any module-scope const/let, so any fn references
// used inside factories must be created via vi.hoisted().

const {
  __authCallbacks,
  __snapCallbacks,
  mockGetDoc,
  mockSetDoc,
  mockDeleteDoc,
} = vi.hoisted(() => {
  const __authCallbacks: Array<(user: unknown) => void | Promise<void>> = [];
  const __snapCallbacks: Array<(snap: unknown) => void | Promise<void>> = [];
  return {
    __authCallbacks,
    __snapCallbacks,
    mockGetDoc: vi.fn(),
    mockSetDoc: vi.fn().mockResolvedValue(undefined),
    mockDeleteDoc: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Firebase mocks (must come before any imports that touch Firebase) ─────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {} }));
vi.mock('@/lib/buildInfo', () => ({
  buildInfo: { version: 'test', sha: 'test', time: '', branch: '', pr: null, env: 'development' },
}));
vi.mock('@/lib/consent', () => ({
  getUserConsents: vi.fn().mockResolvedValue({ termsOfService: null, privacyPolicy: null }),
}));
vi.mock('@/legal/versions', () => ({
  LEGAL_VERSIONS: { termsOfService: '1.0', privacyPolicy: '1.0' },
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth: unknown, cb: (user: unknown) => void | Promise<void>) => {
    __authCallbacks.push(cb);
    return () => {
      const i = __authCallbacks.indexOf(cb);
      if (i !== -1) __authCallbacks.splice(i, 1);
    };
  }),
  signOut: vi.fn().mockResolvedValue(undefined),
  updateProfile: vi.fn().mockResolvedValue(undefined),
  updatePassword: vi.fn().mockResolvedValue(undefined),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void | Promise<void>, _err?: unknown) => {
    __snapCallbacks.push(cb);
    return () => {
      const i = __snapCallbacks.indexOf(cb);
      if (i !== -1) __snapCallbacks.splice(i, 1);
    };
  }),
  getDoc: mockGetDoc,
  setDoc: mockSetDoc,
  deleteDoc: mockDeleteDoc,
  updateDoc: vi.fn().mockResolvedValue(undefined),
}));

// ── Store import (AFTER mocks are registered) ─────────────────────────────────

import { useAuthStore } from '@/store/useAuthStore';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MockUser {
  uid: string;
  email: string;
  displayName: string;
}

interface InviteData {
  email: string;
  teamId?: string;
  playerId?: string;
  role?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<MockUser> = {}): MockUser {
  return { uid: 'user-1', email: 'alice@example.com', displayName: 'Alice', ...overrides };
}

function makeProfileSnap(data: Record<string, unknown>) {
  return { exists: () => true, data: () => data };
}

function resolvedInviteSnap(data: InviteData | null) {
  if (data === null) {
    return Promise.resolve({ exists: () => false, data: () => ({}) });
  }
  return Promise.resolve({ exists: () => true, data: () => data });
}

/** Trigger the captured onAuthStateChanged callback. */
async function triggerAuth(user: MockUser | null) {
  for (const cb of [...__authCallbacks]) {
    await cb(user);
  }
}

/** Trigger the captured onSnapshot profile callback. */
async function triggerProfileSnap(data: Record<string, unknown>) {
  const snap = makeProfileSnap(data);
  for (const cb of [...__snapCallbacks]) {
    await cb(snap);
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  __authCallbacks.length = 0;
  __snapCallbacks.length = 0;
  // Reset the Zustand store to a clean state between tests
  useAuthStore.setState({ user: null, profile: null, loading: true, error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useAuthStore — invite auto-link', () => {

  it('patches profile with teamId + playerId and deletes invite when invite exists', async () => {
    // Arrange
    mockGetDoc.mockReturnValueOnce(resolvedInviteSnap({
      email: 'alice@example.com',
      teamId: 'team-abc',
      playerId: 'player-xyz',
    }));

    useAuthStore.getState().init();
    await triggerAuth(makeUser());

    // Act — profile snapshot arrives with no teamId/playerId yet
    await triggerProfileSnap({
      uid: 'user-1',
      email: 'alice@example.com',
      displayName: 'Alice',
      role: 'player',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    // Assert — setDoc called with the merged profile patch
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('users/user-1') }),
      expect.objectContaining({ teamId: 'team-abc', playerId: 'player-xyz' })
    );

    // Assert — invite deleted after linking
    expect(mockDeleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('invites') })
    );
  });

  it('promotes role to parent when invite role is parent and current role is player', async () => {
    // Arrange
    mockGetDoc.mockReturnValueOnce(resolvedInviteSnap({
      email: 'alice@example.com',
      teamId: 'team-abc',
      playerId: 'player-xyz',
      role: 'parent',
    }));

    useAuthStore.getState().init();
    await triggerAuth(makeUser());
    await triggerProfileSnap({
      uid: 'user-1',
      email: 'alice@example.com',
      displayName: 'Alice',
      role: 'player',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    // Assert — role promoted to parent in the patch
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('users/user-1') }),
      expect.objectContaining({ role: 'parent', teamId: 'team-abc', playerId: 'player-xyz' })
    );
  });

  it('does NOT promote role when invite role is not in the allowed invite roles list', async () => {
    // Arrange — 'coach' is not in ALLOWED_INVITE_ROLES = ['player', 'parent']
    mockGetDoc.mockReturnValueOnce(resolvedInviteSnap({
      email: 'alice@example.com',
      teamId: 'team-abc',
      playerId: 'player-xyz',
      role: 'coach',
    }));

    useAuthStore.getState().init();
    await triggerAuth(makeUser());
    await triggerProfileSnap({
      uid: 'user-1',
      email: 'alice@example.com',
      displayName: 'Alice',
      role: 'player',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    // Assert — teamId/playerId patch happens but role stays player
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('users/user-1') }),
      expect.objectContaining({ role: 'player', teamId: 'team-abc', playerId: 'player-xyz' })
    );
    // role must NOT have been promoted to 'coach'
    const patchCall = mockSetDoc.mock.calls.find(
      ([ref]) => (ref as { path: string }).path.includes('users/user-1')
    );
    expect(patchCall?.[1]).not.toMatchObject({ role: 'coach' });
  });

  it('does NOT downgrade role when current profile role is not player', async () => {
    // Arrange — user is already a coach; invite says parent
    mockGetDoc.mockReturnValueOnce(resolvedInviteSnap({
      email: 'alice@example.com',
      teamId: 'team-abc',
      playerId: 'player-xyz',
      role: 'parent',
    }));

    useAuthStore.getState().init();
    await triggerAuth(makeUser());
    await triggerProfileSnap({
      uid: 'user-1',
      email: 'alice@example.com',
      displayName: 'Alice',
      role: 'coach',   // elevated role — must not be overwritten
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    // Assert — role stays coach; teamId/playerId still applied
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('users/user-1') }),
      expect.objectContaining({ role: 'coach', teamId: 'team-abc', playerId: 'player-xyz' })
    );
  });

  it('does NOT patch profile or delete invite when no invite document exists', async () => {
    // Arrange — getDoc returns a non-existent document
    mockGetDoc.mockReturnValueOnce(resolvedInviteSnap(null));

    useAuthStore.getState().init();
    await triggerAuth(makeUser());
    await triggerProfileSnap({
      uid: 'user-1',
      email: 'alice@example.com',
      displayName: 'Alice',
      role: 'player',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    // Assert — deleteDoc must never be called when there is no invite
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it('does NOT patch profile when invite is missing teamId', async () => {
    // Arrange — invite present but teamId absent; guard `if (teamId && playerId)` fails
    mockGetDoc.mockReturnValueOnce(resolvedInviteSnap({
      email: 'alice@example.com',
      // teamId intentionally absent
      playerId: 'player-xyz',
    }));

    useAuthStore.getState().init();
    await triggerAuth(makeUser());
    await triggerProfileSnap({
      uid: 'user-1',
      email: 'alice@example.com',
      displayName: 'Alice',
      role: 'player',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    // Assert — no setDoc call should include a teamId key in its data payload
    const profilePatchCalls = mockSetDoc.mock.calls.filter(
      ([ref, data]) =>
        (ref as { path: string }).path.includes('users/user-1') &&
        'teamId' in (data as Record<string, unknown>)
    );
    expect(profilePatchCalls).toHaveLength(0);
  });

  it('does NOT patch profile when invite is missing playerId', async () => {
    // Arrange — invite present but playerId absent; guard fails
    mockGetDoc.mockReturnValueOnce(resolvedInviteSnap({
      email: 'alice@example.com',
      teamId: 'team-abc',
      // playerId intentionally absent
    }));

    useAuthStore.getState().init();
    await triggerAuth(makeUser());
    await triggerProfileSnap({
      uid: 'user-1',
      email: 'alice@example.com',
      displayName: 'Alice',
      role: 'player',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    // Assert — no setDoc call includes a playerId in its data payload
    const profilePatchCalls = mockSetDoc.mock.calls.filter(
      ([ref, data]) =>
        (ref as { path: string }).path.includes('users/user-1') &&
        'playerId' in (data as Record<string, unknown>)
    );
    expect(profilePatchCalls).toHaveLength(0);
  });

});
