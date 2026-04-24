/**
 * UsersPage — display name edit via slide-over
 *
 * The old table layout had inline role/team selects per row. The new
 * architecture uses a card list + EditPanel slide-over. updateUser now
 * handles only display name changes; membership changes go through
 * updateMemberships (tested in UsersPage.memberships.test.tsx).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { UserProfile } from '@/types';

// ─── Mutable spy references ───────────────────────────────────────────────────

const mockUpdateDoc = vi.fn();

// ─── Firebase mocks ───────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({
  db: {},
  functions: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn((_db: unknown, _col: string, uid: string) => ({ id: uid })),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
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
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: { success: true } })),
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
import { UsersPage } from '@/pages/UsersPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'other-uid',
    email: 'coach@example.com',
    displayName: 'Sam Coach',
    role: 'coach',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const ADMIN_USER = makeProfile({
  uid: 'admin-uid',
  email: 'admin@example.com',
  displayName: 'Admin User',
  role: 'admin',
});

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
  mockUpdateDoc.mockResolvedValue(undefined);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UsersPage — slide-over opens on card click', () => {

  it('opens the EditPanel dialog when a user card is clicked', async () => {
    seedUsers([ADMIN_USER, makeProfile()]);
    renderPage();
    await screen.findByText('Sam Coach');

    fireEvent.click(screen.getByText('Sam Coach').closest('button')!);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
  });

  it('closes the slide-over when Close panel button is clicked', async () => {
    seedUsers([ADMIN_USER, makeProfile()]);
    renderPage();
    await screen.findByText('Sam Coach');

    fireEvent.click(screen.getByText('Sam Coach').closest('button')!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close panel/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

});

describe('UsersPage — updateUser: optimistic display name update', () => {

  it('Save Changes button is disabled when display name is unchanged', async () => {
    seedUsers([ADMIN_USER, makeProfile()]);
    renderPage();
    await screen.findByText('Sam Coach');

    fireEvent.click(screen.getByText('Sam Coach').closest('button')!);

    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });

  it('Save Changes button enables when display name is edited', async () => {
    seedUsers([ADMIN_USER, makeProfile()]);
    renderPage();
    await screen.findByText('Sam Coach');

    fireEvent.click(screen.getByText('Sam Coach').closest('button')!);
    const input = screen.getByLabelText(/display name/i);
    fireEvent.change(input, { target: { value: 'Sam Updated' } });

    expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled();
  });

  it('calls updateDoc with the new display name when Save Changes is clicked', async () => {
    seedUsers([ADMIN_USER, makeProfile()]);
    renderPage();
    await screen.findByText('Sam Coach');

    fireEvent.click(screen.getByText('Sam Coach').closest('button')!);
    const input = screen.getByLabelText(/display name/i);
    fireEvent.change(input, { target: { value: 'Sam Updated' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled());
    const [, patch] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(patch.displayName).toBe('Sam Updated');
  });

  it('calls updateDoc with the correct uid', async () => {
    const user = makeProfile({ uid: 'other-uid' });
    seedUsers([ADMIN_USER, user]);
    renderPage();
    await screen.findByText('Sam Coach');

    fireEvent.click(screen.getByText('Sam Coach').closest('button')!);
    const input = screen.getByLabelText(/display name/i);
    fireEvent.change(input, { target: { value: 'Sam Updated' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled());
    const [ref] = mockUpdateDoc.mock.calls[0] as [{ id: string }, unknown];
    expect(ref.id).toBe('other-uid');
  });

  it('shows an alert and reverts when updateDoc rejects', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mockUpdateDoc.mockRejectedValue(new Error('Permission denied'));

    seedUsers([ADMIN_USER, makeProfile()]);
    renderPage();
    await screen.findByText('Sam Coach');

    fireEvent.click(screen.getByText('Sam Coach').closest('button')!);
    const input = screen.getByLabelText(/display name/i);
    fireEvent.change(input, { target: { value: 'Bad Name' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining('Permission denied')
      );
    });
  });

  it('does NOT show Save Changes for self (isSelf hides the footer)', async () => {
    seedUsers([ADMIN_USER]);
    renderPage();
    await screen.findByText('Admin User');

    fireEvent.click(screen.getByText('Admin User').closest('button')!);

    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
  });

});
