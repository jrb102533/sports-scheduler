/**
 * AuthActionPage — custom branded password reset page
 *
 * Covers:
 *   - Invalid/missing oobCode → shows invalid state (not the form)
 *   - Wrong mode (e.g. verifyEmail) → shows invalid state
 *   - Missing mode entirely → shows invalid state
 *   - Valid params → shows the password reset form
 *   - Form validates: password < 8 chars → shows error, does not call confirmPasswordReset
 *   - Form validates: passwords don't match → shows error
 *   - Successful submit → calls confirmPasswordReset(auth, oobCode, newPassword), shows success state
 *   - Firebase error auth/expired-action-code → shows user-friendly message
 *   - Firebase error auth/invalid-action-code → shows user-friendly message
 *   - "Back to sign in" link navigates to /login from both invalid and success states
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({
  auth: { name: 'mock-auth' },
  db: {},
  functions: {},
}));

const mockConfirmPasswordReset = vi.fn();

vi.mock('firebase/auth', () => ({
  confirmPasswordReset: (...args: unknown[]) => mockConfirmPasswordReset(...args),
}));

vi.mock('@/lib/buildInfo', () => ({
  buildInfo: { version: 'test', sha: 'test', time: '', branch: '', pr: null, env: 'development' },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { AuthActionPage } from '@/pages/AuthActionPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Render AuthActionPage with the given query-string parameters.
 * e.g. renderWithParams({ mode: 'resetPassword', oobCode: 'abc123' })
 */
function renderWithParams(params: Record<string, string> = {}) {
  const search = new URLSearchParams(params).toString();
  const initialEntry = search ? `/auth/action?${search}` : '/auth/action';
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthActionPage />
    </MemoryRouter>
  );
}

function fillPasswords(newPassword: string, confirmPassword: string) {
  const inputs = document.querySelectorAll('input[type="password"]');
  fireEvent.change(inputs[0], { target: { value: newPassword } });
  fireEvent.change(inputs[1], { target: { value: confirmPassword } });
}

async function submitForm() {
  fireEvent.click(screen.getByRole('button', { name: /set new password/i }));
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests: invalid-state rendering ───────────────────────────────────────────

describe('AuthActionPage — invalid state', () => {
  it('shows the invalid-link state when oobCode is missing', () => {
    renderWithParams({ mode: 'resetPassword' });
    expect(screen.getByText(/invalid link/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set new password/i })).not.toBeInTheDocument();
  });

  it('shows the invalid-link state when mode is wrong (verifyEmail)', () => {
    renderWithParams({ mode: 'verifyEmail', oobCode: 'abc123' });
    expect(screen.getByText(/invalid link/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set new password/i })).not.toBeInTheDocument();
  });

  it('shows the invalid-link state when mode is entirely missing', () => {
    renderWithParams({ oobCode: 'abc123' });
    expect(screen.getByText(/invalid link/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set new password/i })).not.toBeInTheDocument();
  });

  it('shows the invalid-link state when both mode and oobCode are missing', () => {
    renderWithParams();
    expect(screen.getByText(/invalid link/i)).toBeInTheDocument();
  });

  it('renders a "Back to sign in" link pointing to /login in the invalid state', () => {
    renderWithParams({ mode: 'resetPassword' });
    const link = screen.getByRole('link', { name: /back to sign in/i });
    expect(link).toHaveAttribute('href', '/login');
  });
});

// ─── Tests: form rendering ─────────────────────────────────────────────────────

describe('AuthActionPage — form state', () => {
  it('shows the password reset form when mode and oobCode are valid', () => {
    renderWithParams({ mode: 'resetPassword', oobCode: 'abc123' });
    expect(screen.getByRole('button', { name: /set new password/i })).toBeInTheDocument();
  });

  it('renders both new-password and confirm-password inputs', () => {
    renderWithParams({ mode: 'resetPassword', oobCode: 'abc123' });
    const inputs = document.querySelectorAll('input[type="password"]');
    expect(inputs).toHaveLength(2);
  });

  it('renders a "Back to sign in" link in the form state', () => {
    renderWithParams({ mode: 'resetPassword', oobCode: 'abc123' });
    const link = screen.getByRole('link', { name: /back to sign in/i });
    expect(link).toHaveAttribute('href', '/login');
  });
});

// ─── Tests: client-side validation ────────────────────────────────────────────

describe('AuthActionPage — validation', () => {
  it('shows an error and does not call confirmPasswordReset when password is too short', async () => {
    renderWithParams({ mode: 'resetPassword', oobCode: 'abc123' });

    fillPasswords('short', 'short');
    await submitForm();

    await waitFor(() => {
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    });
    expect(mockConfirmPasswordReset).not.toHaveBeenCalled();
  });

  it('shows an error and does not call confirmPasswordReset when passwords do not match', async () => {
    renderWithParams({ mode: 'resetPassword', oobCode: 'abc123' });

    fillPasswords('password123', 'different1');
    await submitForm();

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });
    expect(mockConfirmPasswordReset).not.toHaveBeenCalled();
  });

  it('shows both errors when password is short AND passwords do not match', async () => {
    renderWithParams({ mode: 'resetPassword', oobCode: 'abc123' });

    fillPasswords('abc', 'xyz');
    await submitForm();

    await waitFor(() => {
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });
    expect(mockConfirmPasswordReset).not.toHaveBeenCalled();
  });
});

// ─── Tests: successful submit ─────────────────────────────────────────────────

describe('AuthActionPage — successful password reset', () => {
  it('calls confirmPasswordReset with auth, oobCode, and new password on valid submit', async () => {
    mockConfirmPasswordReset.mockResolvedValue(undefined);
    renderWithParams({ mode: 'resetPassword', oobCode: 'test-oob-code' });

    fillPasswords('newpassword1', 'newpassword1');
    await submitForm();

    await waitFor(() => {
      expect(mockConfirmPasswordReset).toHaveBeenCalledWith(
        { name: 'mock-auth' },
        'test-oob-code',
        'newpassword1'
      );
    });
  });

  it('shows the success state after a successful password reset', async () => {
    mockConfirmPasswordReset.mockResolvedValue(undefined);
    renderWithParams({ mode: 'resetPassword', oobCode: 'abc123' });

    fillPasswords('newpassword1', 'newpassword1');
    await submitForm();

    await waitFor(() => {
      expect(screen.getByText(/password updated/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /set new password/i })).not.toBeInTheDocument();
  });

  it('renders a "Back to sign in" link pointing to /login in the success state', async () => {
    mockConfirmPasswordReset.mockResolvedValue(undefined);
    renderWithParams({ mode: 'resetPassword', oobCode: 'abc123' });

    fillPasswords('newpassword1', 'newpassword1');
    await submitForm();

    await waitFor(() => {
      expect(screen.getByText(/password updated/i)).toBeInTheDocument();
    });

    const link = screen.getByRole('link', { name: /back to sign in/i });
    expect(link).toHaveAttribute('href', '/login');
  });
});

// ─── Tests: Firebase error handling ───────────────────────────────────────────

describe('AuthActionPage — Firebase error handling', () => {
  it('shows a user-friendly message for auth/expired-action-code', async () => {
    const err = Object.assign(new Error('expired'), { code: 'auth/expired-action-code' });
    mockConfirmPasswordReset.mockRejectedValue(err);
    renderWithParams({ mode: 'resetPassword', oobCode: 'expired-code' });

    fillPasswords('newpassword1', 'newpassword1');
    await submitForm();

    await waitFor(() => {
      expect(
        screen.getByText(/expired or already been used/i)
      ).toBeInTheDocument();
    });
    // Should stay on the form, not transition to success
    expect(screen.queryByText(/password updated/i)).not.toBeInTheDocument();
  });

  it('shows a user-friendly message for auth/invalid-action-code', async () => {
    const err = Object.assign(new Error('invalid'), { code: 'auth/invalid-action-code' });
    mockConfirmPasswordReset.mockRejectedValue(err);
    renderWithParams({ mode: 'resetPassword', oobCode: 'invalid-code' });

    fillPasswords('newpassword1', 'newpassword1');
    await submitForm();

    await waitFor(() => {
      expect(
        screen.getByText(/expired or already been used/i)
      ).toBeInTheDocument();
    });
  });

  it('shows a generic error message for unexpected Firebase errors', async () => {
    const err = Object.assign(new Error('network'), { code: 'auth/network-request-failed' });
    mockConfirmPasswordReset.mockRejectedValue(err);
    renderWithParams({ mode: 'resetPassword', oobCode: 'abc123' });

    fillPasswords('newpassword1', 'newpassword1');
    await submitForm();

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
  });

  it('re-enables the submit button after a Firebase error', async () => {
    const err = Object.assign(new Error('expired'), { code: 'auth/expired-action-code' });
    mockConfirmPasswordReset.mockRejectedValue(err);
    renderWithParams({ mode: 'resetPassword', oobCode: 'abc123' });

    fillPasswords('newpassword1', 'newpassword1');
    await submitForm();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /set new password/i })).not.toBeDisabled();
    });
  });
});
