/**
 * useAuthStore.login — emailVerified gate tests (FW-43)
 *
 * login() must block users whose Firebase Auth account is not email-verified.
 * Before blocking, it calls the `checkInviteAutoVerify` CF to give invited users
 * a chance to be auto-verified.  Only if that CF returns { verified: false } (or
 * fails) is the sign-in rejected.
 *
 * Coverage:
 *   1. login() throws with code auth/email-not-verified when emailVerified is false
 *      and checkInviteAutoVerify returns { verified: false }
 *   2. login() calls signOut before throwing when emailVerified is false
 *   3. login() sets store.error to the verification message when emailVerified is false
 *   4. login() succeeds (no throw, no signOut) when emailVerified is true
 *   5. login() succeeds when emailVerified becomes true after checkInviteAutoVerify
 *      returns { verified: true } and user.reload() is called
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock firebase/auth ────────────────────────────────────────────────────────

const mockSignOut = vi.fn().mockResolvedValue(undefined);
const mockReload = vi.fn().mockResolvedValue(undefined);
const mockSignInWithEmailAndPassword = vi.fn();

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: (...args: unknown[]) =>
    mockSignInWithEmailAndPassword(...args),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  onAuthStateChanged: vi.fn(() => () => {}),
  updateProfile: vi.fn().mockResolvedValue(undefined),
  updatePassword: vi.fn().mockResolvedValue(undefined),
  sendEmailVerification: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock firebase/firestore ───────────────────────────────────────────────────

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  onSnapshot: vi.fn(() => () => {}),
}));

// ─── Mock firebase/functions ───────────────────────────────────────────────────

// The factory is re-used per test — we reassign mockCheckInviteAutoVerifyImpl in
// each test to control what the CF returns for that scenario.
let mockCheckInviteAutoVerifyImpl: () => Promise<{ data: { verified: boolean } }>;

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((_functions: unknown, name: string) => {
    if (name === 'checkInviteAutoVerify') {
      return () => mockCheckInviteAutoVerifyImpl();
    }
    // Default for any other callable
    return vi.fn().mockResolvedValue({ data: {} });
  }),
}));

// ─── Mock @/lib/firebase ──────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({
  auth: {},
  db: {},
  functions: {},
}));

// ─── Mock @/lib/consent ──────────────────────────────────────────────────────

vi.mock('@/lib/consent', () => ({
  getUserConsents: vi.fn().mockResolvedValue({}),
}));

// ─── Mock @/legal/versions ────────────────────────────────────────────────────

vi.mock('@/legal/versions', () => ({
  LEGAL_VERSIONS: { termsOfService: '1.0', privacyPolicy: '1.0' },
}));

// ─── Import store AFTER mocks are registered ──────────────────────────────────

import { useAuthStore } from './useAuthStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a fake Firebase Auth credential with a user object. */
function makeCred(emailVerified: boolean) {
  return {
    user: {
      uid: 'uid-test',
      email: 'user@example.com',
      emailVerified,
      reload: mockReload,
    },
  };
}

/** Run login() and capture { error, threw }. */
async function runLogin(email = 'user@example.com', password = 'pass') {
  useAuthStore.setState({ error: null });
  let threw = false;
  try {
    await useAuthStore.getState().login(email, password);
  } catch {
    threw = true;
  }
  return { error: useAuthStore.getState().error, threw };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('login() — emailVerified gate (FW-43)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ error: null });
    // Default: CF says not verified — ensures the non-invited path is blocked.
    mockCheckInviteAutoVerifyImpl = () => Promise.resolve({ data: { verified: false } });
  });

  it('(1) throws with code auth/email-not-verified when emailVerified is false and CF returns { verified: false }', async () => {
    mockSignInWithEmailAndPassword.mockResolvedValue(makeCred(false));

    useAuthStore.setState({ error: null });
    let thrownError: unknown;
    try {
      await useAuthStore.getState().login('user@example.com', 'pass');
    } catch (e) {
      thrownError = e;
    }

    expect((thrownError as { code?: string }).code).toBe('auth/email-not-verified');
  });

  it('(2) calls signOut before throwing when emailVerified is false', async () => {
    mockSignInWithEmailAndPassword.mockResolvedValue(makeCred(false));

    await runLogin();

    expect(mockSignOut).toHaveBeenCalled();
  });

  it('(3) sets store.error to the verification message when emailVerified is false', async () => {
    mockSignInWithEmailAndPassword.mockResolvedValue(makeCred(false));

    const { error } = await runLogin();

    expect(error).toBe(
      'Please verify your email before signing in. Check your inbox for a verification link.',
    );
  });

  it('(4) does not throw and does not call signOut when emailVerified is true', async () => {
    mockSignInWithEmailAndPassword.mockResolvedValue(makeCred(true));

    const { threw } = await runLogin();

    expect(threw).toBe(false);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('(4) leaves store.error as null on successful login with emailVerified: true', async () => {
    mockSignInWithEmailAndPassword.mockResolvedValue(makeCred(true));

    const { error } = await runLogin();

    expect(error).toBeNull();
  });

  it('(5) succeeds when checkInviteAutoVerify returns { verified: true } and user.reload() is called', async () => {
    // Simulate: user signs in with emailVerified: false, but is an invited user.
    // The CF updates Auth and returns { verified: true }.  login() reloads the user
    // and should not sign them out.
    mockCheckInviteAutoVerifyImpl = () => Promise.resolve({ data: { verified: true } });
    mockSignInWithEmailAndPassword.mockResolvedValue(makeCred(false));

    const { threw } = await runLogin();

    expect(threw).toBe(false);
    expect(mockReload).toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
