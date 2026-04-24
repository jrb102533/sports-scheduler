/**
 * useAuthStore — FW-9: invite bypass of signup allowlist
 *
 * FW-9: When signup() is called with a truthy inviteSecret, the allowlist gate
 * (system/signupConfig) must be skipped entirely so that invited users can
 * complete signup even when sign-ups are restricted.
 *
 * The implementation uses a previewInvite CF to verify the secret server-side.
 * If the CF returns { valid: true, email } and the email matches, the allowlist
 * check is bypassed. If the CF is unavailable, control falls back to the
 * allowlist check (so a bad/fake secret still hits the gate).
 *
 * Security guarantee: bypassing the client allowlist is safe because
 * verifyInvitedUser (called later in signup) is the authoritative enforcement
 * point. A fake inviteSecret causes that CF to return { found: false }, which
 * triggers email verification + sign-out — no privilege escalation is possible.
 *
 * Test strategy: call the real useAuthStore.signup() action with Firebase mocks
 * controlled per-test. Assert Firestore getDoc (signupConfig) is never called
 * when a valid invite is present, and IS called when signup is open=false with
 * no invite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firebase stubs ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {}, functions: {} }));

const mockGetDoc = vi.fn();
const mockCreateUser = vi.fn();
const mockUpdateProfile = vi.fn();
const mockSendVerification = vi.fn();
const mockSignOut = vi.fn();
const mockSetDoc = vi.fn();

// httpsCallable returns different functions depending on the name passed to it.
// previewInvite is called first; verifyInvitedUser is called after account creation.
const mockPreviewInvite = vi.fn();
const mockVerifyInvitedUser = vi.fn();

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: (...args: unknown[]) => mockCreateUser(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
  sendEmailVerification: (...args: unknown[]) => mockSendVerification(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  onAuthStateChanged: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  onSnapshot: vi.fn(),
  updateDoc: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((_functions: unknown, name: string) => {
    if (name === 'previewInvite') return mockPreviewInvite;
    if (name === 'verifyInvitedUser') return mockVerifyInvitedUser;
    return vi.fn();
  }),
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

/** A minimal Firebase User-like object returned by createUserWithEmailAndPassword. */
function makeFakeUser(email: string) {
  return {
    uid: 'uid-test-123',
    email,
    emailVerified: false,
    displayName: null,
    reload: vi.fn(),
    getIdToken: vi.fn().mockResolvedValue('token'),
    getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
  };
}

/** Firestore snapshot for a closed allowlist with no allowed emails/domains. */
function closedConfigSnap() {
  return {
    exists: () => true,
    data: () => ({ open: false, allowedEmails: [], allowedDomains: [] }),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useAuthStore.signup() — FW-9: invite allowlist bypass', () => {
  let useAuthStore: typeof import('@/store/useAuthStore').useAuthStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ useAuthStore } = await import('@/store/useAuthStore'));
    useAuthStore.setState({ error: null });

    // Default: account creation succeeds
    const fakeUser = makeFakeUser('invited@example.com');
    mockCreateUser.mockResolvedValue({ user: fakeUser });
    mockUpdateProfile.mockResolvedValue(undefined);
    mockSetDoc.mockResolvedValue(undefined);
    mockSendVerification.mockResolvedValue(undefined);
    mockSignOut.mockResolvedValue(undefined);

    // verifyInvitedUser reports the invite was found (happy path)
    mockVerifyInvitedUser.mockResolvedValue({ data: { found: true } });
  });

  it('skips getDoc(signupConfig) when previewInvite confirms a valid invite for the same email', async () => {
    // previewInvite returns valid + matching email
    mockPreviewInvite.mockResolvedValue({ data: { valid: true, email: 'invited@example.com' } });

    await useAuthStore.getState().signup(
      'invited@example.com',
      'Password1!',
      'Invited User',
      'player',
      undefined,
      undefined,
      'valid-secret-abc'
    );

    // signupConfig must never be fetched — the invite alone is sufficient authorization
    expect(mockGetDoc).not.toHaveBeenCalled();
    // Account creation must proceed
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.anything(),
      'invited@example.com',
      'Password1!'
    );
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('still reaches account creation when allowlist is closed and a valid invite is present', async () => {
    // Allowlist is closed — getDoc returns a closed config
    mockGetDoc.mockResolvedValue(closedConfigSnap());
    // But the invite is valid for this email
    mockPreviewInvite.mockResolvedValue({ data: { valid: true, email: 'new@example.com' } });

    const fakeUser = makeFakeUser('new@example.com');
    mockCreateUser.mockResolvedValue({ user: fakeUser });

    await useAuthStore.getState().signup(
      'new@example.com',
      'Password1!',
      'New User',
      'player',
      undefined,
      undefined,
      'invite-secret-xyz'
    );

    // getDoc should not have been called — bypass happened before the gate
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(mockCreateUser).toHaveBeenCalled();
  });

  it('throws the allowlist error when signup is closed and no inviteSecret is provided', async () => {
    // Signup is closed, no allowed emails
    mockGetDoc.mockResolvedValue(closedConfigSnap());

    await expect(
      useAuthStore.getState().signup(
        'stranger@example.com',
        'Password1!',
        'Stranger',
        'player'
      )
    ).rejects.toThrow(/restricted/i);

    expect(mockGetDoc).toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(useAuthStore.getState().error).toMatch(/restricted/i);
  });

  it('throws the allowlist error when signup is closed and inviteSecret is an empty string', async () => {
    mockGetDoc.mockResolvedValue(closedConfigSnap());

    await expect(
      useAuthStore.getState().signup(
        'stranger@example.com',
        'Password1!',
        'Stranger',
        'player',
        undefined,
        undefined,
        ''
      )
    ).rejects.toThrow(/restricted/i);

    expect(mockGetDoc).toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('falls back to allowlist check when previewInvite CF is unavailable (network error)', async () => {
    // CF throws — simulate network failure
    mockPreviewInvite.mockRejectedValue(new Error('network error'));
    // Allowlist is closed
    mockGetDoc.mockResolvedValue(closedConfigSnap());

    await expect(
      useAuthStore.getState().signup(
        'stranger@example.com',
        'Password1!',
        'Stranger',
        'player',
        undefined,
        undefined,
        'unverifiable-secret'
      )
    ).rejects.toThrow(/restricted/i);

    // Fell through to allowlist gate
    expect(mockGetDoc).toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('falls back to allowlist check when previewInvite returns valid=false (bad secret)', async () => {
    // CF is available but secret is invalid
    mockPreviewInvite.mockResolvedValue({ data: { valid: false, email: null } });
    // Allowlist is closed
    mockGetDoc.mockResolvedValue(closedConfigSnap());

    await expect(
      useAuthStore.getState().signup(
        'stranger@example.com',
        'Password1!',
        'Stranger',
        'player',
        undefined,
        undefined,
        'bad-secret'
      )
    ).rejects.toThrow(/restricted/i);

    expect(mockGetDoc).toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('falls back to allowlist check when previewInvite email does not match the signup email', async () => {
    // CF confirms the secret but for a different email address
    mockPreviewInvite.mockResolvedValue({ data: { valid: true, email: 'other@example.com' } });
    // Allowlist is closed
    mockGetDoc.mockResolvedValue(closedConfigSnap());

    await expect(
      useAuthStore.getState().signup(
        'attacker@example.com',
        'Password1!',
        'Attacker',
        'player',
        undefined,
        undefined,
        'stolen-secret'
      )
    ).rejects.toThrow(/restricted/i);

    // Email mismatch — no bypass, allowlist gate enforced
    expect(mockGetDoc).toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });
});
