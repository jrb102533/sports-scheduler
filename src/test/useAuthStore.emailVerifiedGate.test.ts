/**
 * useAuthStore — emailVerified gate in login (Option B)
 *
 * Verifies the login function blocks users whose email is not verified,
 * but gracefully bypasses the gate for invited users via checkInviteAutoVerify.
 *
 * Coverage:
 *   1. Verified user: emailVerified=true → login succeeds, no CF call
 *   2. Unverified + autoVerify invite: CF returns { verified: true } → login succeeds
 *   3. Unverified + no invite: CF returns { verified: false } → login blocked with
 *      code 'auth/email-not-verified'
 *   4. Unverified + CF throws unexpectedly → login blocked with 'auth/email-not-verified'
 *   5. Error message for blocked login matches the user-facing string in mapAuthError
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firebase stubs ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {}, functions: {} }));

const mockSignOut = vi.fn().mockResolvedValue(undefined);
const mockReload = vi.fn().mockResolvedValue(undefined);

// Build a fake Firebase user object. emailVerified is configurable per-test.
function makeFakeUser(emailVerified: boolean) {
  return {
    uid: 'uid-test',
    email: 'user@example.com',
    emailVerified,
    reload: mockReload,
    getIdToken: vi.fn().mockResolvedValue('token'),
    getIdTokenResult: vi.fn().mockResolvedValue({ claims: { role: null } }),
  };
}

const mockSignIn = vi.fn();

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: (...args: unknown[]) => mockSignIn(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  onAuthStateChanged: vi.fn(),
  sendEmailVerification: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
  updateDoc: vi.fn(),
}));

// ── checkInviteAutoVerify CF mock ─────────────────────────────────────────────

const mockCheckInviteAutoVerify = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((_functions: unknown, name: string) => {
    if (name === 'checkInviteAutoVerify') return mockCheckInviteAutoVerify;
    return vi.fn().mockResolvedValue({ data: {} });
  }),
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useAuthStore.login — emailVerified gate (Option B)', () => {
  let useAuthStore: typeof import('@/store/useAuthStore').useAuthStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ useAuthStore } = await import('@/store/useAuthStore'));
    useAuthStore.setState({ error: null });
  });

  it('(1) does not call checkInviteAutoVerify when emailVerified is already true', async () => {
    mockSignIn.mockResolvedValue({ user: makeFakeUser(true) });

    await useAuthStore.getState().login('user@example.com', 'password');

    expect(mockCheckInviteAutoVerify).not.toHaveBeenCalled();
  });

  it('(2) allows login when emailVerified is false but CF confirms autoVerify invite', async () => {
    const user = makeFakeUser(false);
    mockSignIn.mockResolvedValue({ user });
    mockCheckInviteAutoVerify.mockResolvedValue({ data: { verified: true } });
    // After reload the user is considered verified by the in-memory user object.
    // The real SDK refreshes the token on reload; we simulate by not throwing.
    mockReload.mockResolvedValue(undefined);

    await expect(
      useAuthStore.getState().login('user@example.com', 'password')
    ).resolves.not.toThrow();
  });

  it('(2) calls CF reload on the user object after a successful autoVerify', async () => {
    const user = makeFakeUser(false);
    mockSignIn.mockResolvedValue({ user });
    mockCheckInviteAutoVerify.mockResolvedValue({ data: { verified: true } });

    await useAuthStore.getState().login('user@example.com', 'password');

    expect(mockReload).toHaveBeenCalled();
  });

  it('(3) blocks login with auth/email-not-verified when CF returns { verified: false }', async () => {
    mockSignIn.mockResolvedValue({ user: makeFakeUser(false) });
    mockCheckInviteAutoVerify.mockResolvedValue({ data: { verified: false } });

    await expect(
      useAuthStore.getState().login('user@example.com', 'password')
    ).rejects.toMatchObject({ code: 'auth/email-not-verified' });
  });

  it('(3) signs out the user when the email gate blocks login', async () => {
    mockSignIn.mockResolvedValue({ user: makeFakeUser(false) });
    mockCheckInviteAutoVerify.mockResolvedValue({ data: { verified: false } });

    await expect(
      useAuthStore.getState().login('user@example.com', 'password')
    ).rejects.toThrow();

    expect(mockSignOut).toHaveBeenCalled();
  });

  it('(4) blocks login with auth/email-not-verified when CF throws unexpectedly', async () => {
    mockSignIn.mockResolvedValue({ user: makeFakeUser(false) });
    mockCheckInviteAutoVerify.mockRejectedValue(new Error('CF timeout'));

    await expect(
      useAuthStore.getState().login('user@example.com', 'password')
    ).rejects.toMatchObject({ code: 'auth/email-not-verified' });
  });

  it('(5) store error message for blocked login matches the user-facing verification string', async () => {
    mockSignIn.mockResolvedValue({ user: makeFakeUser(false) });
    mockCheckInviteAutoVerify.mockResolvedValue({ data: { verified: false } });

    await expect(
      useAuthStore.getState().login('user@example.com', 'password')
    ).rejects.toThrow();

    expect(useAuthStore.getState().error).toMatch(/verify your email/i);
  });
});
