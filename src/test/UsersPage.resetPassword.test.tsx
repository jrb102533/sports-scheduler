/**
 * UsersPage — Send Password Reset Email
 *
 * Covers the new KeyRound button, confirmation dialog, and toast introduced
 * alongside the resetUserPassword Cloud Function.
 *
 * Strategy: render UsersPage with mocked stores and mocked Firebase modules.
 * getDocs returns a canned user list.  httpsCallable returns a vi.fn() spy
 * so individual tests can control success/failure without a live emulator.
 *
 * Mocking note: all three stores use selectors (s => s.x), so each mock
 * receives the selector as an argument and calls it with a stub state object.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { UserProfile } from '@/types';

// ─── Mutable spy references ───────────────────────────────────────────────────

const mockCallableFn = vi.fn();

// ─── Firebase mocks ───────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({
  db: {},
  functions: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mockCallableFn),
}));

// ─── Store mocks (selector pattern) ──────────────────────────────────────────

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: { teams: never[] }) => unknown) =>
    selector({ teams: [] }),
}));

vi.mock('@/store/useLeagueStore', () => ({
  useLeagueStore: (selector: (s: { leagues: never[] }) => unknown) =>
    selector({ leagues: [] }),
}));

// useAuthStore uses: s => s.user?.uid
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { user: { uid: string } | null }) => unknown) =>
    selector({ user: { uid: 'admin-uid' } }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { getDocs } from 'firebase/firestore';
import { UsersPage } from '@/pages/UsersPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeUserProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'other-uid',
    email: 'player@example.com',
    displayName: 'Alex Jones',
    role: 'player',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const ADMIN_USER = makeUserProfile({
  uid: 'admin-uid',
  email: 'admin@example.com',
  displayName: 'Admin User',
  role: 'admin',
});

const OTHER_USER = makeUserProfile();

function seedUsers(users: UserProfile[]) {
  (getDocs as ReturnType<typeof vi.fn>).mockResolvedValue({
    docs: users.map(u => ({ data: () => u })),
  });
}

function renderPage() {
  return render(<UsersPage />);
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockCallableFn.mockResolvedValue({ data: { success: true } });
  // By default seed: the logged-in admin + one other user
  seedUsers([ADMIN_USER, OTHER_USER]);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UsersPage — reset password button', () => {

  it('renders the reset-password button for other users', async () => {
    renderPage();
    await screen.findByText('Alex Jones');
    expect(
      screen.getByRole('button', { name: /send password reset email to Alex Jones/i })
    ).toBeInTheDocument();
  });

  it('does NOT render the reset-password button for the current user (self)', async () => {
    renderPage();
    await screen.findByText('Admin User');
    expect(
      screen.queryByRole('button', { name: /send password reset email to Admin User/i })
    ).not.toBeInTheDocument();
  });

  it('opens the confirmation dialog when the reset button is clicked', async () => {
    renderPage();
    await screen.findByText('Alex Jones');

    fireEvent.click(
      screen.getByRole('button', { name: /send password reset email to Alex Jones/i })
    );

    expect(screen.getByText('Send Password Reset Email')).toBeInTheDocument();
    expect(screen.getByText(/send a password reset email to player@example.com/i)).toBeInTheDocument();
  });

  it('does NOT call the Cloud Function when the dialog is cancelled', async () => {
    renderPage();
    await screen.findByText('Alex Jones');

    fireEvent.click(
      screen.getByRole('button', { name: /send password reset email to Alex Jones/i })
    );

    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));

    expect(mockCallableFn).not.toHaveBeenCalled();
  });

  it('calls the Cloud Function with the correct uid on confirm', async () => {
    renderPage();
    await screen.findByText('Alex Jones');

    fireEvent.click(
      screen.getByRole('button', { name: /send password reset email to Alex Jones/i })
    );
    fireEvent.click(screen.getByRole('button', { name: /^Send Reset Email$/i }));

    await waitFor(() => {
      expect(mockCallableFn).toHaveBeenCalledWith({ uid: 'other-uid' });
    });
  });

  it('shows a success toast after the email is sent', async () => {
    renderPage();
    await screen.findByText('Alex Jones');

    fireEvent.click(
      screen.getByRole('button', { name: /send password reset email to Alex Jones/i })
    );
    fireEvent.click(screen.getByRole('button', { name: /^Send Reset Email$/i }));

    await screen.findByRole('status');
    expect(screen.getByRole('status')).toHaveTextContent(
      /password reset email sent to player@example.com/i
    );
  });

  it('dismisses the toast when the X button is clicked', async () => {
    renderPage();
    await screen.findByText('Alex Jones');

    fireEvent.click(
      screen.getByRole('button', { name: /send password reset email to Alex Jones/i })
    );
    fireEvent.click(screen.getByRole('button', { name: /^Send Reset Email$/i }));

    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: /dismiss notification/i }));

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  it('disables the reset button while the call is in-flight', async () => {
    // Never settle — keeps the button disabled indefinitely
    mockCallableFn.mockReturnValue(new Promise(() => {}));

    renderPage();
    await screen.findByText('Alex Jones');

    const btn = screen.getByRole('button', {
      name: /send password reset email to Alex Jones/i,
    });
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('button', { name: /^Send Reset Email$/i }));

    await waitFor(() => {
      expect(btn).toBeDisabled();
    });
  });

  it('re-enables the reset button after the call resolves', async () => {
    renderPage();
    await screen.findByText('Alex Jones');

    const btn = screen.getByRole('button', {
      name: /send password reset email to Alex Jones/i,
    });
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('button', { name: /^Send Reset Email$/i }));

    // Disabled while in-flight, then re-enabled on resolution
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it('shows an alert and re-enables the button when the Cloud Function throws', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mockCallableFn.mockRejectedValue(new Error('Functions call failed'));

    renderPage();
    await screen.findByText('Alex Jones');

    const btn = screen.getByRole('button', {
      name: /send password reset email to Alex Jones/i,
    });
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('button', { name: /^Send Reset Email$/i }));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining('Functions call failed')
      );
    });
    expect(btn).not.toBeDisabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does NOT show a success toast when the Cloud Function throws', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    mockCallableFn.mockRejectedValue(new Error('Network error'));

    renderPage();
    await screen.findByText('Alex Jones');

    fireEvent.click(
      screen.getByRole('button', { name: /send password reset email to Alex Jones/i })
    );
    fireEvent.click(screen.getByRole('button', { name: /^Send Reset Email$/i }));

    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('UsersPage — loading state', () => {
  it('renders a loading indicator while users are being fetched', () => {
    (getDocs as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading users/i)).toBeInTheDocument();
  });
});

describe('UsersPage — empty state', () => {
  it('renders the table with no data rows when the users collection is empty', async () => {
    seedUsers([]);
    renderPage();
    // Table header should appear; no user rows
    await screen.findByText(/registered users/i);
    expect(screen.queryByRole('button', { name: /send password reset email/i })).not.toBeInTheDocument();
  });
});
