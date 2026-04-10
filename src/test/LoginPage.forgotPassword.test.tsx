/**
 * LoginPage — forgot password flow
 *
 * Verifies that clicking "Forgot password?" calls sendPasswordResetEmail
 * with the correct actionCodeSettings, specifically:
 *   url: `${VITE_APP_URL}/auth/action`
 *
 * This ensures the Firebase email link lands on our custom branded
 * AuthActionPage rather than the Firebase default UI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/lib/firebase', () => ({
  auth: { name: 'mock-auth' },
  db: {},
  functions: {},
}));

vi.mock('@/lib/buildInfo', () => ({
  buildInfo: { version: 'test', sha: 'test', time: '', branch: '', pr: null, env: 'development' },
}));

const mockSendPasswordResetEmail = vi.fn();

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(),
  sendPasswordResetEmail: (...args: unknown[]) => mockSendPasswordResetEmail(...args),
}));

// ─── Auth store mock ──────────────────────────────────────────────────────────

const mockLogin = vi.fn();
const mockResendVerificationEmail = vi.fn();
const mockClearError = vi.fn();

let mockStoreState = {
  error: null as string | null,
};

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector?: (s: typeof mockStoreState & {
    login: typeof mockLogin;
    resendVerificationEmail: typeof mockResendVerificationEmail;
    clearError: typeof mockClearError;
  }) => unknown) => {
    const state = {
      ...mockStoreState,
      login: mockLogin,
      resendVerificationEmail: mockResendVerificationEmail,
      clearError: mockClearError,
    };
    return selector ? selector(state) : state;
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { LoginPage } from '@/pages/LoginPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

function fillEmail(email: string) {
  fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
    target: { value: email },
  });
}

function clickForgotPassword() {
  fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreState = { error: null };
  // Set the VITE_APP_URL env var so the URL assertion matches
  import.meta.env.VITE_APP_URL = 'https://app.staging.example.com';
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LoginPage — forgot password', () => {
  it('calls sendPasswordResetEmail with actionCodeSettings pointing to /auth/action', async () => {
    mockSendPasswordResetEmail.mockResolvedValue(undefined);
    renderPage();

    fillEmail('user@example.com');
    clickForgotPassword();

    await waitFor(() => {
      expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
        { name: 'mock-auth' },
        'user@example.com',
        expect.objectContaining({
          url: expect.stringContaining('/auth/action'),
        })
      );
    });
  });

  it('calls sendPasswordResetEmail with the trimmed email address', async () => {
    mockSendPasswordResetEmail.mockResolvedValue(undefined);
    renderPage();

    fillEmail('  user@example.com  ');
    clickForgotPassword();

    await waitFor(() => {
      expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
        expect.anything(),
        'user@example.com',
        expect.any(Object)
      );
    });
  });

  it('shows a confirmation message after the reset email is sent', async () => {
    mockSendPasswordResetEmail.mockResolvedValue(undefined);
    renderPage();

    fillEmail('user@example.com');
    clickForgotPassword();

    await waitFor(() => {
      expect(screen.getByText(/reset email sent/i)).toBeInTheDocument();
    });
  });

  it('replaces the "Forgot password?" button with the confirmation message on success', async () => {
    mockSendPasswordResetEmail.mockResolvedValue(undefined);
    renderPage();

    fillEmail('user@example.com');
    clickForgotPassword();

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /forgot password/i })
      ).not.toBeInTheDocument();
    });
  });

  it('shows an error when email field is empty and "Forgot password?" is clicked', async () => {
    renderPage();

    // Do NOT fill email — click immediately
    clickForgotPassword();

    await waitFor(() => {
      expect(screen.getByText(/enter your email address/i)).toBeInTheDocument();
    });
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('shows an error message when sendPasswordResetEmail fails', async () => {
    mockSendPasswordResetEmail.mockRejectedValue(new Error('User not found'));
    renderPage();

    fillEmail('nobody@example.com');
    clickForgotPassword();

    await waitFor(() => {
      expect(screen.getByText(/could not send reset email/i)).toBeInTheDocument();
    });
  });

  it('does not call sendPasswordResetEmail when the email field is empty', () => {
    renderPage();
    clickForgotPassword();
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
  });
});
