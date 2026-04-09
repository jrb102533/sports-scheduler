/**
 * useAuthStore — mapAuthError contract tests
 *
 * mapAuthError is a module-private function; we test it via the login() action,
 * which calls it and surfaces the result as store.error.
 *
 * These tests lock in the error-code → UI-message contract so that accidental
 * changes to mapAuthError are caught immediately at unit-test level, independent
 * of Firebase rate-limits or E2E flakiness.  See issue #339.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock firebase/auth ────────────────────────────────────────────────────────

const mockSignInWithEmailAndPassword = vi.fn();
const mockOnAuthStateChanged = vi.fn(() => () => {});

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: (...args: unknown[]) =>
    mockSignInWithEmailAndPassword(...args),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
  updateProfile: vi.fn().mockResolvedValue(undefined),
  updatePassword: vi.fn().mockResolvedValue(undefined),
  sendEmailVerification: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock firebase/firestore ───────────────────────────────────────────────────

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  onSnapshot: vi.fn(() => () => {}),
}));

// ── Mock firebase/functions ───────────────────────────────────────────────────

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: { found: false } })),
}));

// ── Mock @/lib/firebase ───────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({
  auth: {},
  db: {},
  functions: {},
}));

// ── Mock @/lib/consent ────────────────────────────────────────────────────────

vi.mock('@/lib/consent', () => ({
  getUserConsents: vi.fn().mockResolvedValue({}),
}));

// ── Mock @/legal/versions ─────────────────────────────────────────────────────

vi.mock('@/legal/versions', () => ({
  LEGAL_VERSIONS: { termsOfService: '1.0', privacyPolicy: '1.0' },
}));

// ── Import store AFTER mocks are registered ───────────────────────────────────

import { useAuthStore } from './useAuthStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simulate Firebase throwing a structured auth error. */
function makeFirebaseAuthError(code: string, message = `Firebase: ${code}`) {
  return Object.assign(new Error(message), { code });
}

/** Run login() and capture the resulting store.error string. */
async function loginAndGetError(email = 'probe@example.com', password = 'wrong') {
  useAuthStore.setState({ error: null });
  await useAuthStore.getState().login(email, password).catch(() => {});
  return useAuthStore.getState().error;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('mapAuthError — login error codes → UI messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ error: null });
  });

  it('maps auth/invalid-credential to "Incorrect email or password."', async () => {
    mockSignInWithEmailAndPassword.mockRejectedValue(
      makeFirebaseAuthError('auth/invalid-credential'),
    );
    const error = await loginAndGetError();
    expect(error).toBe('Incorrect email or password.');
  });

  it('maps auth/wrong-password to "Incorrect email or password."', async () => {
    mockSignInWithEmailAndPassword.mockRejectedValue(
      makeFirebaseAuthError('auth/wrong-password'),
    );
    const error = await loginAndGetError();
    expect(error).toBe('Incorrect email or password.');
  });

  it('maps auth/user-not-found to "Incorrect email or password."', async () => {
    mockSignInWithEmailAndPassword.mockRejectedValue(
      makeFirebaseAuthError('auth/user-not-found'),
    );
    const error = await loginAndGetError();
    expect(error).toBe('Incorrect email or password.');
  });

  it('maps auth/too-many-requests to "Too many attempts. Please try again later."', async () => {
    mockSignInWithEmailAndPassword.mockRejectedValue(
      makeFirebaseAuthError('auth/too-many-requests'),
    );
    const error = await loginAndGetError();
    expect(error).toBe('Too many attempts. Please try again later.');
  });

  it('maps auth/user-disabled to the raw Firebase error message (falls through to default)', async () => {
    // auth/user-disabled is not explicitly mapped — it falls through to the default
    // which returns the Error.message directly.  This test documents the current
    // behaviour so that an accidental mapping change is caught.
    const msg = 'Firebase: Error (auth/user-disabled).';
    mockSignInWithEmailAndPassword.mockRejectedValue(
      makeFirebaseAuthError('auth/user-disabled', msg),
    );
    const error = await loginAndGetError();
    expect(error).toBe(msg);
  });

  it('maps auth/network-request-failed to the network error message', async () => {
    mockSignInWithEmailAndPassword.mockRejectedValue(
      makeFirebaseAuthError('auth/network-request-failed'),
    );
    const error = await loginAndGetError();
    expect(error).toBe('Network error. Check your connection and try again.');
  });

  it('maps auth/invalid-email to the invalid email message', async () => {
    mockSignInWithEmailAndPassword.mockRejectedValue(
      makeFirebaseAuthError('auth/invalid-email'),
    );
    const error = await loginAndGetError();
    expect(error).toBe('Please enter a valid email address.');
  });

  it('returns a fallback message for unknown error codes', async () => {
    const msg = 'Something unexpected happened.';
    mockSignInWithEmailAndPassword.mockRejectedValue(
      makeFirebaseAuthError('auth/unknown-future-code', msg),
    );
    const error = await loginAndGetError();
    // Falls through to (e as Error).message
    expect(error).toBe(msg);
  });

  it('returns fallback when the thrown value has no code', async () => {
    const msg = 'Plain JS error with no code.';
    mockSignInWithEmailAndPassword.mockRejectedValue(new Error(msg));
    const error = await loginAndGetError();
    expect(error).toBe(msg);
  });

  // The codes below are primarily surfaced via signup(), but mapAuthError is shared
  // by both login() and signup().  Document their mappings here so the full contract
  // is locked in at unit level regardless of which action triggers them.

  it('maps auth/email-already-in-use to "An account with this email already exists."', async () => {
    mockSignInWithEmailAndPassword.mockRejectedValue(
      makeFirebaseAuthError('auth/email-already-in-use'),
    );
    const error = await loginAndGetError();
    expect(error).toBe('An account with this email already exists.');
  });

  it('maps auth/weak-password to "Password must be at least 6 characters."', async () => {
    mockSignInWithEmailAndPassword.mockRejectedValue(
      makeFirebaseAuthError('auth/weak-password'),
    );
    const error = await loginAndGetError();
    expect(error).toBe('Password must be at least 6 characters.');
  });

  it('maps auth/email-not-verified to the email verification message', async () => {
    // This code is thrown internally by login() when emailVerified is false,
    // then caught by the outer catch and passed through mapAuthError.
    mockSignInWithEmailAndPassword.mockRejectedValue(
      makeFirebaseAuthError('auth/email-not-verified'),
    );
    const error = await loginAndGetError();
    expect(error).toBe(
      'Please verify your email before signing in. Check your inbox for a verification link.',
    );
  });
});
