/**
 * useAuthStore — mapAuthError SEC-24
 *
 * SEC-24: user-enumeration fix. The three error codes that previously revealed
 * whether an account existed must all return the same message:
 *   auth/user-not-found    → "Incorrect email or password."
 *   auth/wrong-password    → "Incorrect email or password."
 *   auth/invalid-credential→ "Incorrect email or password."
 *
 * Strategy: call the real `useAuthStore.login` action with a
 * `signInWithEmailAndPassword` mock that throws a Firebase-style error object
 * carrying a specific `code` field. Assert that the store's `error` state is
 * set to the expected message after the call rejects.
 *
 * Note: `mapAuthError` is a private function. We test it through the public
 * `login` action, which is the only call path that matters for the fix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firebase stubs ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {}, functions: {} }));

const mockSignIn = vi.fn();

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: (...args: unknown[]) => mockSignIn(...args),
  signOut: vi.fn().mockResolvedValue(undefined),
  onAuthStateChanged: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
  updateDoc: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
  getFunctions: vi.fn(),
}));

vi.mock('@/lib/consent', () => ({
  getUserConsents: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/legal/versions', () => ({
  LEGAL_VERSIONS: { termsOfService: '1.0', privacyPolicy: '1.0' },
}));

vi.mock('@/lib/buildInfo', () => ({
  buildInfo: { version: 'test', sha: 'test', time: '', branch: '', pr: null, env: 'development' },
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFirebaseError(code: string): Error & { code: string } {
  const err = new Error(code) as Error & { code: string };
  err.code = code;
  return err;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useAuthStore — login error messages (SEC-24)', () => {
  let useAuthStore: typeof import('@/store/useAuthStore').useAuthStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-import to get a fresh store instance with cleared state
    vi.resetModules();
    ({ useAuthStore } = await import('@/store/useAuthStore'));
    // Reset store error
    useAuthStore.setState({ error: null });
  });

  const EXPECTED_MESSAGE = 'Incorrect email or password.';

  it('returns the generic message for auth/user-not-found (no account enumeration)', async () => {
    mockSignIn.mockRejectedValue(makeFirebaseError('auth/user-not-found'));

    await expect(
      useAuthStore.getState().login('ghost@example.com', 'password')
    ).rejects.toThrow();

    expect(useAuthStore.getState().error).toBe(EXPECTED_MESSAGE);
  });

  it('returns the same message for auth/wrong-password', async () => {
    mockSignIn.mockRejectedValue(makeFirebaseError('auth/wrong-password'));

    await expect(
      useAuthStore.getState().login('user@example.com', 'wrong')
    ).rejects.toThrow();

    expect(useAuthStore.getState().error).toBe(EXPECTED_MESSAGE);
  });

  it('returns the same message for auth/invalid-credential', async () => {
    mockSignIn.mockRejectedValue(makeFirebaseError('auth/invalid-credential'));

    await expect(
      useAuthStore.getState().login('user@example.com', 'wrong')
    ).rejects.toThrow();

    expect(useAuthStore.getState().error).toBe(EXPECTED_MESSAGE);
  });

  it('all three error codes produce identical messages (no divergence)', async () => {
    const codes = ['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential'];
    const messages: string[] = [];

    for (const code of codes) {
      useAuthStore.setState({ error: null });
      mockSignIn.mockRejectedValue(makeFirebaseError(code));
      await expect(
        useAuthStore.getState().login('u@example.com', 'p')
      ).rejects.toThrow();
      messages.push(useAuthStore.getState().error ?? '');
    }

    // All three must be identical
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBe(EXPECTED_MESSAGE);
  });

  it('does NOT return the generic message for auth/too-many-requests (different code)', async () => {
    mockSignIn.mockRejectedValue(makeFirebaseError('auth/too-many-requests'));

    await expect(
      useAuthStore.getState().login('user@example.com', 'password')
    ).rejects.toThrow();

    expect(useAuthStore.getState().error).not.toBe(EXPECTED_MESSAGE);
    expect(useAuthStore.getState().error).toMatch(/too many attempts/i);
  });
});
