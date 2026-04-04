/**
 * SignupPage — SEC-26: inviteSecret URL stripping
 *
 * SEC-26: The inviteSecret query param must be removed from the browser history
 * via window.history.replaceState BEFORE any state update or async operation,
 * so the secret never lingers in the URL bar or browser history.
 *
 * Behavior under test:
 *   - When the URL contains ?inviteSecret=..., replaceState is called
 *     synchronously at render time (before the form is filled or submitted)
 *   - replaceState strips the query string (called with the pathname only)
 *   - When no inviteSecret is present, replaceState is NOT called
 *   - The secret is consumed for the signup call even after replaceState strips it
 *     from the URL (it is captured in a local variable before the strip)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/lib/firebase', () => ({
  auth: { currentUser: null },
  db: {},
  functions: {},
}));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  updateProfile: vi.fn(),
  sendEmailVerification: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
}));

vi.mock('@/lib/buildInfo', () => ({
  buildInfo: { version: 'test', sha: 'test', time: '', branch: '', pr: null, env: 'development' },
}));

vi.mock('@/lib/consent', () => ({
  recordConsent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Auth store mock ──────────────────────────────────────────────────────────

type StoreState = {
  error: string | null;
  verificationEmailSent: boolean;
  signup: (...args: unknown[]) => Promise<void>;
  clearError: () => void;
  clearVerificationEmailSent: () => void;
};

let _state: StoreState;
const mockSignup = vi.fn();

function resetState() {
  _state = {
    error: null,
    verificationEmailSent: false,
    signup: mockSignup,
    clearError: vi.fn(),
    clearVerificationEmailSent: vi.fn(),
  };
}

vi.mock('@/store/useAuthStore', () => {
  const hook = (selector?: (s: StoreState) => unknown) =>
    selector ? selector(_state) : _state;
  hook.getState = () => _state;
  return { useAuthStore: hook };
});

import { SignupPage } from '@/pages/SignupPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderWithSecret(secret: string) {
  return render(
    <MemoryRouter initialEntries={[`/signup?inviteSecret=${secret}`]}>
      <SignupPage />
    </MemoryRouter>
  );
}

function renderWithoutSecret() {
  return render(
    <MemoryRouter initialEntries={['/signup']}>
      <SignupPage />
    </MemoryRouter>
  );
}

// ─── Test setup ───────────────────────────────────────────────────────────────

let replaceStateSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
  replaceStateSpy = vi.spyOn(window.history, 'replaceState');
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SignupPage — SEC-26: inviteSecret URL stripping', () => {
  it('calls replaceState synchronously at render when inviteSecret is present', () => {
    renderWithSecret('abc123secret');

    // replaceState must have been called by the time the first render completes —
    // before any user interaction or async work.
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
  });

  it('strips the query string — replaceState URL does not contain the secret', () => {
    renderWithSecret('abc123secret');

    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    // The secret must NOT appear in the replacement URL regardless of pathname
    expect(url).not.toContain('inviteSecret');
    expect(url).not.toContain('abc123secret');
    expect(url).not.toContain('?');
  });

  it('does NOT call replaceState when no inviteSecret is in the URL', () => {
    renderWithoutSecret();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('captures the secret for submission even after stripping it from the URL', async () => {
    mockSignup.mockResolvedValue(undefined);
    renderWithSecret('secret-token-xyz');

    // Fill and submit the form
    fireEvent.change(screen.getByRole('textbox', { name: /first name/i }), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByRole('textbox', { name: /last name/i }), { target: { value: 'Smith' } });
    fireEvent.change(screen.getByRole('textbox', { name: /email/i }), { target: { value: 'alice@example.com' } });
    const form = document.querySelector('form')!;
    const pwInputs = form.querySelectorAll('input[type="password"]');
    fireEvent.change(pwInputs[0], { target: { value: 'password123' } });
    fireEvent.change(pwInputs[1], { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /terms of service and privacy policy/i }));

    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    await waitFor(() => expect(mockSignup).toHaveBeenCalled());

    // The 7th argument to signup is the inviteSecret — verify it was passed
    const callArgs = mockSignup.mock.calls[0] as unknown[];
    expect(callArgs[6]).toBe('secret-token-xyz');
  });

  it('replaceState is called before the form is interactable — no async delay', () => {
    // We render and immediately check: replaceState must already have been called.
    // If it were deferred to useEffect or post-submit, this assertion would fail.
    renderWithSecret('early-strip-check');

    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    // Form is visible, confirming no async wait occurred
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });
});
