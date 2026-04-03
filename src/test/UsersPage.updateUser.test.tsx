/**
 * UsersPage — updateUser: optimistic update, revert-on-failure,
 * and membership role sync
 *
 * Change under test:
 *   1. updateUser now applies an optimistic local state update before the
 *      Firestore setDoc write, so the UI does not snap back while the save
 *      is in flight.
 *   2. On Firestore failure, state is reverted to the pre-change value and
 *      an alert is shown.
 *   3. When patch.role is provided, the primary membership's role field
 *      is kept in sync.
 *
 * Strategy: same mock harness as UsersPage.resetPassword.test.tsx — Firebase
 * modules are mocked, stores return stub data via selector pattern. setDoc
 * is the key spy: we control whether it resolves or rejects.
 *
 * Interaction surface tested via the role <Select> dropdown, which is the
 * most direct way to trigger updateUser without coupling tests to internals.
 * Team <Select> is used to exercise the teamId undefined-strip path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { UserProfile, RoleMembership } from '@/types';

// ─── Mutable spy references ───────────────────────────────────────────────────

const mockSetDoc = vi.fn();

// ─── Firebase mocks ───────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({
  db: {},
  functions: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn((_db: unknown, _col: string, uid: string) => ({ id: uid })),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  deleteDoc: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: { success: true } })),
}));

// ─── Store mocks (selector pattern) ──────────────────────────────────────────

const TEAM_A = { id: 'team-a', name: 'Team Alpha' };
const TEAM_B = { id: 'team-b', name: 'Team Beta' };

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: { teams: typeof TEAM_A[] }) => unknown) =>
    selector({ teams: [TEAM_A, TEAM_B] }),
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

function seedUsers(users: UserProfile[]) {
  (getDocs as ReturnType<typeof vi.fn>).mockResolvedValue({
    docs: users.map(u => ({ data: () => u })),
  });
}

const ADMIN_USER = makeProfile({
  uid: 'admin-uid',
  email: 'admin@example.com',
  displayName: 'Admin User',
  role: 'admin',
});

function renderPage() {
  return render(<UsersPage />);
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UsersPage — updateUser: optimistic role update', () => {

  it('updates the role select immediately (before setDoc resolves)', async () => {
    // Hold setDoc open so it never resolves during the assertion
    mockSetDoc.mockReturnValue(new Promise(() => {}));

    const user = makeProfile({ role: 'coach' });
    seedUsers([ADMIN_USER, user]);
    renderPage();
    await screen.findByText('Sam Coach');

    const roleSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'player' } });

    // The select should already show 'player' without waiting for Firestore
    expect(roleSelect.value).toBe('player');
  });

  it('persists the optimistic value after setDoc resolves', async () => {
    const user = makeProfile({ role: 'coach' });
    seedUsers([ADMIN_USER, user]);
    renderPage();
    await screen.findByText('Sam Coach');

    const roleSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'player' } });

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalled());
    expect(roleSelect.value).toBe('player');
  });

  it('calls setDoc with the full updated profile including the new role', async () => {
    const user = makeProfile({ role: 'coach', uid: 'other-uid' });
    seedUsers([ADMIN_USER, user]);
    renderPage();
    await screen.findByText('Sam Coach');

    const roleSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'player' } });

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalled());

    const [, written] = mockSetDoc.mock.calls[0] as [unknown, UserProfile];
    expect(written.role).toBe('player');
    expect(written.uid).toBe('other-uid');
  });

});

describe('UsersPage — updateUser: revert on Firestore failure', () => {

  it('reverts the role select to the original value when setDoc rejects', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    mockSetDoc.mockRejectedValue(new Error('Permission denied'));

    const user = makeProfile({ role: 'coach' });
    seedUsers([ADMIN_USER, user]);
    renderPage();
    await screen.findByText('Sam Coach');

    const roleSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'player' } });

    // After the rejection, state should revert
    await waitFor(() => {
      expect(roleSelect.value).toBe('coach');
    });
  });

  it('shows an alert with the error message when setDoc rejects', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mockSetDoc.mockRejectedValue(new Error('Quota exceeded'));

    const user = makeProfile({ role: 'coach' });
    seedUsers([ADMIN_USER, user]);
    renderPage();
    await screen.findByText('Sam Coach');

    const roleSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'player' } });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining('Quota exceeded')
      );
    });
  });

  it('does NOT revert when setDoc succeeds', async () => {
    const user = makeProfile({ role: 'coach' });
    seedUsers([ADMIN_USER, user]);
    renderPage();
    await screen.findByText('Sam Coach');

    const roleSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'league_manager' } });

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalled());

    // Value should remain at the new role, not reverted
    expect(roleSelect.value).toBe('league_manager');
    expect(window.alert).not.toHaveBeenCalled?.();
  });

});

describe('UsersPage — updateUser: membership role sync', () => {

  it('syncs the primary membership role when role is changed', async () => {
    const primaryMembership: RoleMembership = {
      role: 'coach',
      teamId: 'team-a',
      isPrimary: true,
    };
    const secondaryMembership: RoleMembership = {
      role: 'parent',
      isPrimary: false,
    };
    const user = makeProfile({
      role: 'coach',
      memberships: [primaryMembership, secondaryMembership],
    });
    seedUsers([ADMIN_USER, user]);
    renderPage();
    await screen.findByText('Sam Coach');

    const roleSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'player' } });

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalled());

    const [, written] = mockSetDoc.mock.calls[0] as [unknown, UserProfile];
    const primaryWritten = written.memberships?.find(m => m.isPrimary);
    expect(primaryWritten?.role).toBe('player');
  });

  it('does NOT mutate a non-primary membership role when top-level role changes', async () => {
    const primaryMembership: RoleMembership = {
      role: 'coach',
      teamId: 'team-a',
      isPrimary: true,
    };
    const secondaryMembership: RoleMembership = {
      role: 'parent',
      isPrimary: false,
    };
    const user = makeProfile({
      role: 'coach',
      memberships: [primaryMembership, secondaryMembership],
    });
    seedUsers([ADMIN_USER, user]);
    renderPage();
    await screen.findByText('Sam Coach');

    const roleSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'player' } });

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalled());

    const [, written] = mockSetDoc.mock.calls[0] as [unknown, UserProfile];
    const nonPrimary = written.memberships?.find(m => !m.isPrimary);
    // Secondary membership should still be 'parent'
    expect(nonPrimary?.role).toBe('parent');
  });

  it('writes the updated profile when memberships is absent (legacy profile)', async () => {
    // Profiles without memberships should still update top-level role
    const user = makeProfile({ role: 'coach' }); // no memberships field
    seedUsers([ADMIN_USER, user]);
    renderPage();
    await screen.findByText('Sam Coach');

    const roleSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'player' } });

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalled());

    const [, written] = mockSetDoc.mock.calls[0] as [unknown, UserProfile];
    expect(written.role).toBe('player');
    // No memberships to corrupt
    expect(written.memberships).toBeUndefined();
  });

});

describe('UsersPage — updateUser: teamId undefined strip', () => {

  it('strips teamId from the written document when team is cleared', async () => {
    const user = makeProfile({ role: 'coach', teamId: 'team-a' });
    seedUsers([ADMIN_USER, user]);
    renderPage();
    await screen.findByText('Sam Coach');

    // Team select is the second combobox (after role)
    const teamSelect = screen.getAllByRole('combobox')[1] as HTMLSelectElement;
    // Clear the team by selecting the empty option
    fireEvent.change(teamSelect, { target: { value: '' } });

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalled());

    const [, written] = mockSetDoc.mock.calls[0] as [unknown, UserProfile];
    expect(Object.prototype.hasOwnProperty.call(written, 'teamId')).toBe(false);
  });

});
