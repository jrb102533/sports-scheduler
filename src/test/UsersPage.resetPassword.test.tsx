/**
 * UsersPage — Send Password Reset Email
 *
 * Updated for the slide-over (EditPanel) architecture:
 * the reset-password button now lives inside the slide-over, so tests
 * must click a user card to open the panel before asserting on the button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { UserProfile } from '../../types';

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
  doc: vi.fn((_db: unknown, _col: string, uid: string) => ({ id: uid })),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  writeBatch: vi.fn(() => ({
    update: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
  })),
  arrayUnion: vi.fn((v: unknown) => v),
  arrayRemove: vi.fn((v: unknown) => v),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  deleteField: vi.fn(() => ({ __type: 'deleteField' })),
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

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { user: { uid: string } | null }) => unknown) =>
    selector({ user: { uid: 'admin-uid' } }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { getDocs } from 'firebase/firestore';
import { UsersPage, _resetUsersCache } from '../../pages/UsersPage';

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

/** Click a user card by display name to open the EditPanel slide-over. */
async function openSlideOver(displayName: string) {
  const card = screen.getByText(displayName).closest('button')!;
  fireEvent.click(card);
  // Slide-over renders synchronously once state is set
}

function getResetButton() {
  return screen.getByRole('button', { name: /send password reset email/i });
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  _resetUsersCache();
  mockCallableFn.mockResolvedValue({ data: { success: true } });
  seedUsers([ADMIN_USER, OTHER_USER]);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UsersPage — reset password button', () => {

  it('renders the reset-password button inside the slide-over for other users', async () => {
    render(<UsersPage />);
    await screen.findByText('Alex Jones');
    await openSlideOver('Alex Jones');
    expect(getResetButton()).toBeInTheDocument();
  });

  it('does NOT render the reset-password button for the current user (self)', async () => {
    render(<UsersPage />);
    await screen.findByText('Admin User');
    await openSlideOver('Admin User');
    expect(
      screen.queryByRole('button', { name: /send password reset email/i })
    ).not.toBeInTheDocument();
  });

  it('opens the confirmation dialog when the reset button is clicked', async () => {
    render(<UsersPage />);
    await screen.findByText('Alex Jones');
    await openSlideOver('Alex Jones');

    fireEvent.click(getResetButton());

    // The ConfirmDialog shows a confirmation message unique to this action
    expect(screen.getByText(/send a password reset email to player@example.com/i)).toBeInTheDocument();
  });

  it('does NOT call the Cloud Function when the dialog is cancelled', async () => {
    render(<UsersPage />);
    await screen.findByText('Alex Jones');
    await openSlideOver('Alex Jones');

    fireEvent.click(getResetButton());

    // Scope to the ConfirmDialog's content area to avoid the slide-over footer Cancel
    const msg = screen.getByText(/send a password reset email to player@example.com/i);
    fireEvent.click(within(msg.parentElement!).getByRole('button', { name: /^Cancel$/i }));

    expect(mockCallableFn).not.toHaveBeenCalled();
  });

  it('calls the Cloud Function with the correct uid on confirm', async () => {
    render(<UsersPage />);
    await screen.findByText('Alex Jones');
    await openSlideOver('Alex Jones');

    fireEvent.click(getResetButton());
    fireEvent.click(screen.getByRole('button', { name: /^Send Reset Email$/i }));

    await waitFor(() => {
      expect(mockCallableFn).toHaveBeenCalledWith({ uid: 'other-uid' });
    });
  });

  it('shows a success toast after the email is sent', async () => {
    render(<UsersPage />);
    await screen.findByText('Alex Jones');
    await openSlideOver('Alex Jones');

    fireEvent.click(getResetButton());
    fireEvent.click(screen.getByRole('button', { name: /^Send Reset Email$/i }));

    await screen.findByRole('status');
    expect(screen.getByRole('status')).toHaveTextContent(
      /password reset email sent to player@example.com/i
    );
  });

  it('dismisses the toast when the Dismiss button is clicked', async () => {
    render(<UsersPage />);
    await screen.findByText('Alex Jones');
    await openSlideOver('Alex Jones');

    fireEvent.click(getResetButton());
    fireEvent.click(screen.getByRole('button', { name: /^Send Reset Email$/i }));

    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss$/i }));

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  it('shows an alert when the Cloud Function throws', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mockCallableFn.mockRejectedValue(new Error('Functions call failed'));

    render(<UsersPage />);
    await screen.findByText('Alex Jones');
    await openSlideOver('Alex Jones');

    fireEvent.click(getResetButton());
    fireEvent.click(screen.getByRole('button', { name: /^Send Reset Email$/i }));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining('Functions call failed')
      );
    });
  });

  it('does NOT show a success toast when the Cloud Function throws', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    mockCallableFn.mockRejectedValue(new Error('Network error'));

    render(<UsersPage />);
    await screen.findByText('Alex Jones');
    await openSlideOver('Alex Jones');

    fireEvent.click(getResetButton());
    fireEvent.click(screen.getByRole('button', { name: /^Send Reset Email$/i }));

    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

});

describe('UsersPage — loading state', () => {
  it('renders a loading indicator while users are being fetched', () => {
    (getDocs as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<UsersPage />);
    expect(screen.getByText(/loading users/i)).toBeInTheDocument();
  });
});

describe('UsersPage — empty state', () => {
  it('renders an empty state message when the users collection is empty', async () => {
    seedUsers([]);
    render(<UsersPage />);
    await screen.findByText(/no users yet/i);
    expect(
      screen.queryByRole('button', { name: /send password reset email/i })
    ).not.toBeInTheDocument();
  });
});
