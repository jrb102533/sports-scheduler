/**
 * useAuthStore — SEC-77: force token refresh on role change
 *
 * When the Firestore profile snapshot delivers a role that differs from the
 * role claim in the currently cached JWT, the store must call
 * user.getIdToken(true) so that Firestore rules see the updated claim
 * immediately rather than waiting up to 1 hour for the JWT to expire.
 *
 * Regression test for GitHub issue #521.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Shared mock state ─────────────────────────────────────────────────────────

// Capture the onAuthStateChanged callback so we can drive it from tests.
let onAuthStateChangedCallback: ((user: unknown) => void) | null = null;

// Capture the onSnapshot callback so we can drive it from tests.
let onSnapshotCallback: ((snap: unknown) => void) | null = null;

// Mutable token-result — tests set .claims.role to the "cached JWT role".
const mockTokenResult = { claims: { role: 'coach' as string | null } };

// Track getIdToken(true) calls.
const mockGetIdToken = vi.fn().mockResolvedValue('fresh-token');
const mockGetIdTokenResult = vi.fn().mockResolvedValue(mockTokenResult);

// ── Firebase auth mock ────────────────────────────────────────────────────────

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  onAuthStateChanged: vi.fn((_, cb: (user: unknown) => void) => {
    onAuthStateChangedCallback = cb;
    return () => {};
  }),
  updateProfile: vi.fn().mockResolvedValue(undefined),
  updatePassword: vi.fn().mockResolvedValue(undefined),
  sendEmailVerification: vi.fn().mockResolvedValue(undefined),
}));

// ── Firebase firestore mock ───────────────────────────────────────────────────

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  setDoc: vi.fn().mockResolvedValue(undefined),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
    onSnapshotCallback = cb;
    return () => {};
  }),
}));

// ── Firebase functions mock ───────────────────────────────────────────────────

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: {} })),
}));

// ── @/lib/firebase mock ───────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, functions: {} }));

// ── @/lib/consent mock ───────────────────────────────────────────────────────

vi.mock('@/lib/consent', () => ({
  getUserConsents: vi.fn().mockResolvedValue({}),
}));

// ── @/legal/versions mock ─────────────────────────────────────────────────────

vi.mock('@/legal/versions', () => ({
  LEGAL_VERSIONS: { termsOfService: '1.0', privacyPolicy: '1.0' },
}));

// ── Import store AFTER mocks ──────────────────────────────────────────────────

import { useAuthStore } from './useAuthStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A minimal Firebase User object with controllable getIdToken / getIdTokenResult. */
function makeUser(uid = 'uid-test') {
  return {
    uid,
    email: 'user@example.com',
    displayName: 'Test User',
    emailVerified: true,
    getIdToken: mockGetIdToken,
    getIdTokenResult: mockGetIdTokenResult,
    reload: vi.fn().mockResolvedValue(undefined),
  };
}

/** A minimal Firestore snapshot for the user profile. */
function makeProfileSnap(role: string) {
  return {
    exists: () => true,
    data: () => ({
      uid: 'uid-test',
      email: 'user@example.com',
      displayName: 'Test User',
      role,
      createdAt: '2024-01-01T00:00:00.000Z',
    }),
  };
}

/** Drive init(), sign the user in, and return the unsubscribe function. */
function initAndSignIn(user = makeUser()) {
  const unsub = useAuthStore.getState().init();
  // Trigger onAuthStateChanged with a signed-in user.
  onAuthStateChangedCallback!(user);
  return { unsub, user };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SEC-77 — force token refresh on Firestore role change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onAuthStateChangedCallback = null;
    onSnapshotCallback = null;
    // Reset token result to match 'coach' role by default.
    mockTokenResult.claims.role = 'coach';
    mockGetIdToken.mockResolvedValue('fresh-token');
    mockGetIdTokenResult.mockResolvedValue(mockTokenResult);
    useAuthStore.setState({ user: null, profile: null, loading: true, error: null });
  });

  it('calls getIdToken(true) when the Firestore role differs from the JWT claim', async () => {
    const { user } = initAndSignIn();

    // The JWT currently claims the user is 'coach'.
    mockTokenResult.claims.role = 'coach';

    // The Firestore profile arrives with a demoted role of 'player'.
    await onSnapshotCallback!(makeProfileSnap('player'));

    // Give all microtasks time to resolve (getIdTokenResult is async).
    await vi.waitFor(() => {
      // getIdToken(true) must have been called at least once after the
      // initial sign-in refresh AND as a result of the role mismatch.
      const forceRefreshCalls = mockGetIdToken.mock.calls.filter(
        ([forceRefresh]) => forceRefresh === true,
      );
      expect(forceRefreshCalls.length).toBeGreaterThanOrEqual(1);
    });

    // Also confirm getIdTokenResult was consulted to detect the mismatch.
    expect(user.getIdTokenResult).toHaveBeenCalled();
  });

  it('does NOT call getIdToken(true) a second time when the role is unchanged', async () => {
    const { user } = initAndSignIn();

    // JWT role and Firestore role both match — no change.
    mockTokenResult.claims.role = 'coach';

    // Reset the call count after the initial sign-in force-refresh.
    await vi.waitFor(() => expect(mockGetIdToken).toHaveBeenCalled());
    mockGetIdToken.mockClear();

    // Deliver a snapshot where the role hasn't changed.
    await onSnapshotCallback!(makeProfileSnap('coach'));

    // Allow microtasks to drain.
    await new Promise(resolve => setTimeout(resolve, 0));

    // getIdToken(true) must NOT have been called again.
    const forceRefreshCalls = mockGetIdToken.mock.calls.filter(
      ([forceRefresh]) => forceRefresh === true,
    );
    expect(forceRefreshCalls.length).toBe(0);

    expect(user.getIdTokenResult).toHaveBeenCalled();
  });

  it('calls getIdToken(true) when the JWT has no role claim and the profile has one', async () => {
    initAndSignIn();

    // JWT has no role claim (null).
    mockTokenResult.claims.role = null as unknown as string;

    await onSnapshotCallback!(makeProfileSnap('admin'));

    await vi.waitFor(() => {
      const forceRefreshCalls = mockGetIdToken.mock.calls.filter(
        ([forceRefresh]) => forceRefresh === true,
      );
      expect(forceRefreshCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('calls getIdToken(true) when the role changes from coach to league_manager', async () => {
    initAndSignIn();

    mockTokenResult.claims.role = 'coach';

    // Clear initial sign-in refresh so we only measure the role-change refresh.
    await vi.waitFor(() => expect(mockGetIdToken).toHaveBeenCalled());
    mockGetIdToken.mockClear();

    await onSnapshotCallback!(makeProfileSnap('league_manager'));

    await vi.waitFor(() => {
      const forceRefreshCalls = mockGetIdToken.mock.calls.filter(
        ([forceRefresh]) => forceRefresh === true,
      );
      expect(forceRefreshCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
