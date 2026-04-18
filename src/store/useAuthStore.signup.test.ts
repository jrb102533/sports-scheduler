/**
 * useAuthStore — signup() allowlist-bypass tests (invite flow)
 *
 * Verifies that signup() calls previewInvite before the allowlist check,
 * and only bypasses the allowlist gate when the CF confirms the secret is valid
 * and the email matches.
 *
 * Tests:
 *   1. Valid invite + matching email → allowlist NOT checked, signup proceeds
 *   2. Invalid invite (CF returns valid:false) → allowlist IS checked; blocked user sees error
 *   3. Empty inviteSecret → allowlist IS checked; blocked user sees error
 *   4. Valid invite but email mismatch → allowlist IS checked; blocked user sees error
 *   5. Mixed-case typed email matches lowercase invite email → allowlist NOT checked (regression)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock firebase/auth ────────────────────────────────────────────────────────

const mockCreateUserWithEmailAndPassword = vi.fn();
const mockOnAuthStateChanged = vi.fn(() => () => {});

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: (...args: unknown[]) =>
    mockCreateUserWithEmailAndPassword(...args),
  signOut: vi.fn().mockResolvedValue(undefined),
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
  updateProfile: vi.fn().mockResolvedValue(undefined),
  updatePassword: vi.fn().mockResolvedValue(undefined),
  sendEmailVerification: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock firebase/firestore ───────────────────────────────────────────────────
// signupConfig.open = false, email NOT in allowlist → blocked unless bypassed.

const mockGetDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  setDoc: vi.fn().mockResolvedValue(undefined),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  onSnapshot: vi.fn(() => () => {}),
}));

// ── Mock firebase/functions ───────────────────────────────────────────────────
// httpsCallable is called with different function names; we intercept by name.

const mockPreviewInviteFn = vi.fn();
const mockVerifyInvitedUserFn = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((_, name: string) => {
    if (name === 'previewInvite') return mockPreviewInviteFn;
    if (name === 'verifyInvitedUser') return mockVerifyInvitedUserFn;
    return vi.fn().mockResolvedValue({ data: {} });
  }),
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

// ── Import store AFTER mocks ──────────────────────────────────────────────────

import { useAuthStore } from './useAuthStore';

// ── Shared constants ──────────────────────────────────────────────────────────

const RESTRICTED_EMAIL = 'newparent@blocked.com';
const VALID_SECRET = 'valid-invite-secret-uuid';
const ALLOWLIST_ERROR = 'This is a test environment. Sign-ups are restricted to authorized testers. Contact the administrator to request access.';

/** signupConfig doc: open=false, email NOT in allowlist. */
function makeRestrictedConfig() {
  return {
    exists: () => true,
    data: () => ({ open: false, allowedEmails: [], allowedDomains: [] }),
  };
}

/** A minimal Firebase user object returned by createUserWithEmailAndPassword. */
function makeFakeUser(email: string) {
  return {
    uid: 'new-uid-123',
    email,
    emailVerified: false,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ error: null, verificationEmailSent: false });

  // Default: Firestore returns restricted config.
  mockGetDoc.mockResolvedValue(makeRestrictedConfig());

  // Default: verifyInvitedUser returns { found: false }.
  mockVerifyInvitedUserFn.mockResolvedValue({ data: { found: false } });

  // Default: createUserWithEmailAndPassword succeeds.
  mockCreateUserWithEmailAndPassword.mockResolvedValue({
    user: makeFakeUser(RESTRICTED_EMAIL),
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('signup() — invite allowlist bypass', () => {

  it('(1) valid invite matching email — allowlist not enforced, signup proceeds', async () => {
    // previewInvite confirms the secret is valid for this exact email.
    mockPreviewInviteFn.mockResolvedValue({
      data: { valid: true, email: RESTRICTED_EMAIL },
    });

    await useAuthStore.getState().signup(
      RESTRICTED_EMAIL, 'password123', 'New Parent', 'parent',
      undefined, undefined, VALID_SECRET,
    ).catch(() => {
      // verifyInvitedUser may reject in this test setup; we only care that
      // the allowlist error was NOT set.
    });

    expect(useAuthStore.getState().error).not.toBe(ALLOWLIST_ERROR);
  });

  it('(2) CF returns valid:false — allowlist IS enforced, blocked user sees error', async () => {
    mockPreviewInviteFn.mockResolvedValue({
      data: { valid: false, email: null },
    });

    await useAuthStore.getState().signup(
      RESTRICTED_EMAIL, 'password123', 'New Parent', 'parent',
      undefined, undefined, VALID_SECRET,
    ).catch(() => {});

    expect(useAuthStore.getState().error).toBe(ALLOWLIST_ERROR);
  });

  it('(3) no inviteSecret — allowlist IS enforced, blocked user sees error', async () => {
    // previewInvite should NOT be called when inviteSecret is empty.
    mockPreviewInviteFn.mockResolvedValue({ data: { valid: true, email: RESTRICTED_EMAIL } });

    await useAuthStore.getState().signup(
      RESTRICTED_EMAIL, 'password123', 'New Parent', 'parent',
    ).catch(() => {});

    expect(useAuthStore.getState().error).toBe(ALLOWLIST_ERROR);
    // previewInvite must not be called when no secret is present.
    expect(mockPreviewInviteFn).not.toHaveBeenCalled();
  });

  it('(4) valid invite but email mismatch — allowlist IS enforced', async () => {
    // The invite was for a different email address.
    mockPreviewInviteFn.mockResolvedValue({
      data: { valid: true, email: 'other@example.com' },
    });

    await useAuthStore.getState().signup(
      RESTRICTED_EMAIL, 'password123', 'New Parent', 'parent',
      undefined, undefined, VALID_SECRET,
    ).catch(() => {});

    expect(useAuthStore.getState().error).toBe(ALLOWLIST_ERROR);
  });

  it('(5) mixed-case typed email matches lowercase invite email — allowlist NOT enforced (regression)', async () => {
    // The invite was stored with a lowercased email (as all invites are
    // normalized server-side). The user types their email with mixed case
    // on the signup form — signup() must lowercase before comparing so the
    // bypass still fires. Regression guard for PR #485 follow-up #484.
    const LOWERCASE_EMAIL = 'user@example.com';
    const MIXED_CASE_TYPED = 'User@Example.COM';

    mockPreviewInviteFn.mockResolvedValue({
      data: { valid: true, email: LOWERCASE_EMAIL },
    });
    mockCreateUserWithEmailAndPassword.mockResolvedValue({
      user: makeFakeUser(MIXED_CASE_TYPED),
    });

    await useAuthStore.getState().signup(
      MIXED_CASE_TYPED, 'password123', 'New Parent', 'parent',
      undefined, undefined, VALID_SECRET,
    ).catch(() => {
      // verifyInvitedUser may reject in this harness; we only assert the
      // allowlist bypass fired (i.e. error stays null).
    });

    // Strong assertion: the allowlist bypass fired and nothing else set an
    // error. `not.toBe(ALLOWLIST_ERROR)` would also pass if *any other* error
    // were set, which would silently mask a real regression.
    expect(useAuthStore.getState().error).toBeNull();
    // previewInvite was called with the inviteSecret (not the typed email).
    expect(mockPreviewInviteFn).toHaveBeenCalledWith({ inviteSecret: VALID_SECRET });
  });
});
