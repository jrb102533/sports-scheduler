/**
 * SignupPage — email verification flows
 *
 * Tests the Option B email-verification behavior introduced in this PR:
 *   - Form validation: passwords don't match, first name empty
 *   - Invited users: signup resolves with verificationEmailSent=false → navigate to '/'
 *   - Non-invited users: signup sets verificationEmailSent=true → show "Check your email" screen
 *   - CF failure fallback: signup still ends with verificationEmailSent=true
 *   - "Check your email" screen shows submitted email address
 *   - "Back to sign up" button calls clearVerificationEmailSent
 *
 * Strategy:
 *   The SignupPage reads `verificationEmailSent` directly from the Zustand store.
 *   To trigger a re-render, signup mock implementations call `act()` to set that
 *   state via a Zustand store mock that exposes a `setState`-like mechanism.
 *   We mock the entire useAuthStore module and expose a small internal store
 *   so individual tests can control state + trigger re-renders correctly.
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
// We use a simple pub/sub mechanism so that when mockSignup mutates state
// the component receives a new value on the next render triggered by act().

type StoreState = {
  error: string | null;
  verificationEmailSent: boolean;
  signup: (...args: unknown[]) => Promise<void>;
  clearError: () => void;
  clearVerificationEmailSent: () => void;
};

// Mutable state object shared across tests
let _state: StoreState;

const mockSignup = vi.fn();
const mockClearError = vi.fn();
const mockClearVerificationEmailSent = vi.fn();

function resetState() {
  _state = {
    error: null,
    verificationEmailSent: false,
    signup: mockSignup,
    clearError: mockClearError,
    clearVerificationEmailSent: mockClearVerificationEmailSent,
  };
}

// The mock hook just reads from _state every call.  React re-renders when we
// call forceRerender() below.  `getState()` is called directly in SignupPage
// after signup to check verificationEmailSent — that also reads from _state.
vi.mock('@/store/useAuthStore', () => {
  const hook = (selector?: (s: StoreState) => unknown) =>
    selector ? selector(_state) : _state;
  hook.getState = () => _state;
  return { useAuthStore: hook };
});

import { SignupPage } from '@/pages/SignupPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter>
      <SignupPage />
    </MemoryRouter>
  );
}

function fillForm(email = 'alice@example.com') {
  fireEvent.change(screen.getByRole('textbox', { name: /first name/i }), {
    target: { value: 'Alice' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: /last name/i }), {
    target: { value: 'Smith' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
    target: { value: email },
  });
  const form = document.querySelector('form')!;
  const pwInputs = form.querySelectorAll('input[type="password"]');
  fireEvent.change(pwInputs[0], { target: { value: 'password123' } });
  fireEvent.change(pwInputs[1], { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /terms of service and privacy policy/i }));
}

function submitForm() {
  // Submit via the form element to bypass any jsdom HTML5 required-field
  // validation that would otherwise prevent the React onSubmit handler from running.
  const form = document.querySelector('form')!;
  fireEvent.submit(form);
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
  mockClearVerificationEmailSent.mockImplementation(() => {
    _state = { ..._state, verificationEmailSent: false };
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SignupPage — initial render', () => {
  it('renders the signup form', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('disables the submit button until terms are accepted', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled();
  });
});

describe('SignupPage — form validation', () => {
  it('shows a validation error when passwords do not match', async () => {
    renderPage();
    fireEvent.change(screen.getByRole('textbox', { name: /first name/i }), {
      target: { value: 'Alice' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /last name/i }), {
      target: { value: 'Smith' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
      target: { value: 'alice@example.com' },
    });
    const form = document.querySelector('form')!;
    const pwInputs = form.querySelectorAll('input[type="password"]');
    fireEvent.change(pwInputs[0], { target: { value: 'password123' } });
    fireEvent.change(pwInputs[1], { target: { value: 'different456' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /terms of service and privacy policy/i }));

    submitForm();

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });
    expect(mockSignup).not.toHaveBeenCalled();
  });

  it('shows a validation error when first name is empty', async () => {
    renderPage();
    // Deliberately leave first name blank
    fireEvent.change(screen.getByRole('textbox', { name: /last name/i }), {
      target: { value: 'Smith' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
      target: { value: 'alice@example.com' },
    });
    const form = document.querySelector('form')!;
    const pwInputs = form.querySelectorAll('input[type="password"]');
    fireEvent.change(pwInputs[0], { target: { value: 'password123' } });
    fireEvent.change(pwInputs[1], { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /terms of service and privacy policy/i }));

    submitForm();

    await waitFor(() => {
      expect(screen.getByText(/first name is required/i)).toBeInTheDocument();
    });
    expect(mockSignup).not.toHaveBeenCalled();
  });
});

describe('SignupPage — invited user flow (verifyInvitedUser finds invite)', () => {
  it('navigates to "/" after signup when the user is invited', async () => {
    mockSignup.mockResolvedValue(undefined);
    // verificationEmailSent stays false → page calls navigate('/')

    renderPage();
    fillForm();
    submitForm();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  it('does NOT show the "Check your email" screen for invited users', async () => {
    mockSignup.mockResolvedValue(undefined);

    renderPage();
    fillForm();
    submitForm();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument();
  });
});

describe('SignupPage — non-invited user flow (verificationEmailSent: true)', () => {
  it('shows the "Check your email" screen instead of navigating', async () => {
    // signup resolves but sets verificationEmailSent = true on the shared state
    mockSignup.mockImplementation(async () => {
      _state = { ..._state, verificationEmailSent: true };
    });

    renderPage();
    fillForm('newuser@example.com');

    await act(async () => {
      submitForm();
      // Allow the async signup handler to complete
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('displays the submitted email address on the "Check your email" screen', async () => {
    mockSignup.mockImplementation(async () => {
      _state = { ..._state, verificationEmailSent: true };
    });

    renderPage();
    fillForm('newuser@example.com');

    await act(async () => {
      submitForm();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/newuser@example\.com/i)).toBeInTheDocument();
    });
  });

  it('shows the "Back to sign up" button on the "Check your email" screen', async () => {
    mockSignup.mockImplementation(async () => {
      _state = { ..._state, verificationEmailSent: true };
    });

    renderPage();
    fillForm();

    await act(async () => {
      submitForm();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back to sign up/i })).toBeInTheDocument();
    });
  });

  it('"Back to sign up" calls clearVerificationEmailSent', async () => {
    mockSignup.mockImplementation(async () => {
      _state = { ..._state, verificationEmailSent: true };
    });

    renderPage();
    fillForm();

    await act(async () => {
      submitForm();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /back to sign up/i })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: /back to sign up/i }));
    expect(mockClearVerificationEmailSent).toHaveBeenCalled();
  });
});

describe('SignupPage — CF failure fallback', () => {
  it('shows "Check your email" when signup ends with verificationEmailSent=true (CF failure fallback)', async () => {
    mockSignup.mockImplementation(async () => {
      _state = { ..._state, verificationEmailSent: true };
    });

    renderPage();
    fillForm();

    await act(async () => {
      submitForm();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });
  });
});

describe('SignupPage — store error display', () => {
  it('shows a store error when signup fails with a restricted-signup error', async () => {
    mockSignup.mockImplementation(async () => {
      _state = {
        ..._state,
        error: 'Sign-ups are currently restricted. Contact the administrator to request access.',
      };
      throw new Error('Restricted');
    });

    renderPage();
    fillForm();

    await act(async () => {
      submitForm();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Sign-ups are currently restricted/i)
      ).toBeInTheDocument();
    });
  });
});
