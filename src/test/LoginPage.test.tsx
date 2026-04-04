/**
 * LoginPage — email verification enforcement + resend flow
 *
 * Tests the Option B login-gate behavior:
 *   - Successful login navigates to '/'
 *   - When login fails with 'auth/email-not-verified', the error message is shown
 *     AND a "Resend verification email" button appears
 *   - When login fails with any other error, no resend button is shown
 *   - Clicking "Resend verification email" calls resendVerificationEmail
 *   - After a successful resend, shows a confirmation message instead of the button
 *   - When resend itself fails, keeps showing the resend button (does not crash)
 *   - The resend button is disabled while the resend call is in-flight
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
  auth: {},
  db: {},
  functions: {},
}));

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(),
}));

vi.mock('@/lib/buildInfo', () => ({
  buildInfo: { version: 'test', sha: 'test', time: '', branch: '', pr: null, env: 'development' },
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

import { LoginPage } from '@/pages/LoginPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

function fillCredentials(email = 'user@example.com', password = 'password123') {
  fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
    target: { value: email },
  });
  const pwInput = document.querySelector('input[type="password"]')!;
  fireEvent.change(pwInput, { target: { value: password } });
}

async function submitForm() {
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreState = { error: null };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LoginPage — successful login', () => {
  it('renders the login form', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('navigates to "/" after a successful login', async () => {
    mockLogin.mockResolvedValue(undefined);

    renderPage();
    fillCredentials();
    await submitForm();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });
});

describe('LoginPage — unverified email error', () => {
  it('shows the "verify your email" error message when login is blocked', async () => {
    mockLogin.mockImplementation(async () => {
      mockStoreState.error =
        'Please verify your email before signing in. Check your inbox for a verification link.';
      throw new Error('Email not verified');
    });

    renderPage();
    fillCredentials();
    await submitForm();

    await waitFor(() => {
      expect(screen.getByText(/verify your email/i)).toBeInTheDocument();
    });
  });

  it('shows the "Resend verification email" button when the error mentions email verification', async () => {
    mockLogin.mockImplementation(async () => {
      mockStoreState.error =
        'Please verify your email before signing in. Check your inbox for a verification link.';
      throw new Error('Email not verified');
    });

    renderPage();
    fillCredentials();
    await submitForm();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /resend verification email/i })
      ).toBeInTheDocument();
    });
  });

  it('does NOT show the resend button for non-verification errors', async () => {
    mockLogin.mockImplementation(async () => {
      mockStoreState.error = 'Incorrect email or password.';
      throw new Error('Wrong password');
    });

    renderPage();
    fillCredentials();
    await submitForm();

    await waitFor(() => {
      expect(screen.getByText(/incorrect email or password/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /resend verification email/i })
    ).not.toBeInTheDocument();
  });

  it('does not navigate after a failed login', async () => {
    mockLogin.mockImplementation(async () => {
      mockStoreState.error = 'Incorrect email or password.';
      throw new Error('Wrong password');
    });

    renderPage();
    fillCredentials();
    await submitForm();

    await waitFor(() => expect(screen.getByText(/incorrect email or password/i)).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('LoginPage — resend verification email', () => {
  async function setupVerificationErrorState() {
    mockLogin.mockImplementation(async () => {
      mockStoreState.error =
        'Please verify your email before signing in. Check your inbox for a verification link.';
      throw new Error('Email not verified');
    });

    renderPage();
    fillCredentials('user@example.com', 'password123');
    await submitForm();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /resend verification email/i })
      ).toBeInTheDocument();
    });
  }

  it('calls resendVerificationEmail with the current email and password', async () => {
    mockResendVerificationEmail.mockResolvedValue(undefined);
    await setupVerificationErrorState();

    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));

    await waitFor(() => {
      expect(mockResendVerificationEmail).toHaveBeenCalledWith(
        'user@example.com',
        'password123'
      );
    });
  });

  it('shows a confirmation message after a successful resend', async () => {
    mockResendVerificationEmail.mockResolvedValue(undefined);
    await setupVerificationErrorState();

    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));

    await waitFor(() => {
      expect(screen.getByText(/verification email sent/i)).toBeInTheDocument();
    });
  });

  it('replaces the resend button with the confirmation message on success', async () => {
    mockResendVerificationEmail.mockResolvedValue(undefined);
    await setupVerificationErrorState();

    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /resend verification email/i })
      ).not.toBeInTheDocument();
    });
  });

  it('disables the resend button while the resend call is in-flight', async () => {
    // Never settle so the button stays disabled
    mockResendVerificationEmail.mockReturnValue(new Promise(() => {}));
    await setupVerificationErrorState();

    const resendBtn = screen.getByRole('button', { name: /resend verification email/i });
    fireEvent.click(resendBtn);

    await waitFor(() => {
      expect(resendBtn).toBeDisabled();
    });
  });

  it('keeps the resend button when resendVerificationEmail throws', async () => {
    mockResendVerificationEmail.mockImplementation(async () => {
      mockStoreState.error = 'Incorrect email or password.';
      throw new Error('Wrong password');
    });
    await setupVerificationErrorState();

    const resendBtn = screen.getByRole('button', { name: /resend verification email/i });
    fireEvent.click(resendBtn);

    // Button should become enabled again (not show confirmation message)
    await waitFor(() => {
      expect(resendBtn).not.toBeDisabled();
    });
    expect(screen.queryByText(/verification email sent/i)).not.toBeInTheDocument();
  });
});

describe('LoginPage — accessibility', () => {
  it('has a labelled email input', () => {
    renderPage();
    expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument();
  });

  it('submit button is enabled by default', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled();
  });
});
