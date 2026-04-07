/**
 * assignScopedRole.test.tsx
 *
 * Tests for the assignScopedRole feature:
 *
 * AssignCoCoachModal
 *   1. Renders the modal when open=true
 *   2. Renders nothing when open=false
 *   3. Shows validation error when email is empty on submit
 *   4. Does not call the CF when email is empty
 *   5. Calls assignScopedRole CF with correct payload (email trimmed/lowercased, role='coach', teamId)
 *   6. Shows success banner after CF resolves
 *   7. Success banner includes displayName and teamName
 *   8. Clears the email input after success
 *   9. "Add Another" resets to the form
 *  10. "Done" calls onClose after success
 *  11. Shows error message when CF rejects
 *  12. Does not show success state when CF rejects
 *  13. Cancel clears state and calls onClose
 *  14. Reopening clears prior error state
 *
 * AssignCoManagerModal
 *  15. Renders the modal when open=true
 *  16. Renders nothing when open=false
 *  17. Shows validation error when email is empty on submit
 *  18. Calls assignScopedRole CF with correct payload (role='league_manager', leagueId)
 *  19. Shows success banner with displayName and leagueName after success
 *  20. "Done" calls onClose after success
 *  21. Shows error message when CF rejects
 *  22. Cancel clears state and calls onClose
 *
 * TeamDetailPage Info tab — "Add Co-Coach" button visibility
 *  23. Shows "Add Co-Coach" button for a coach (via memberships) on that team
 *  24. Shows "Add Co-Coach" button for a legacy owner (team.coachId === uid)
 *  25. Shows "Add Co-Coach" button for an admin
 *  26. Does NOT show "Add Co-Coach" button for a plain player
 *  27. Does NOT show "Add Co-Coach" button when profile is null
 *
 * LeagueDetailPage header — "Add Co-Manager" button visibility
 *  28. Shows "Add Co-Manager" button for a league_manager with a matching managed league
 *  29. Shows "Add Co-Manager" button for an admin
 *  30. Does NOT show "Add Co-Manager" button for a coach with no LM membership
 *  31. Does NOT show "Add Co-Manager" button for a league_manager scoped to a DIFFERENT league
 *  32. Does NOT show "Add Co-Manager" button when profile is null
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { UserProfile, Team } from '@/types';

// ─── Module-level mock setup ───────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
  storage: {},
}));

// ── Router ────────────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── firebase/functions: shared spy so individual tests can configure return values ──
const mockCallableFn = vi.hoisted(() => vi.fn());
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => mockCallableFn),
}));

// ── firebase/firestore: stubbed for page-level tests ─────────────────────────
vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
  return {
    ...actual,
    getDocs: vi.fn().mockResolvedValue({ docs: [] }),
    query: vi.fn(),
    collection: vi.fn(),
    where: vi.fn(),
    doc: vi.fn(),
    setDoc: vi.fn().mockResolvedValue(undefined),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Auth store (selector pattern, matches contextualRoleBadge.test.tsx template) ──
let currentProfile: UserProfile | null = null;

vi.mock('@/store/useAuthStore', async () => {
  const real = await vi.importActual<typeof import('@/store/useAuthStore')>('@/store/useAuthStore');
  const mockState = {
    user: { uid: 'uid-coach', email: 'coach@example.com' },
    get profile() { return currentProfile; },
    logout: vi.fn(),
    updateProfile: vi.fn(),
  };
  const useAuthStore = (sel?: (s: typeof mockState) => unknown) => {
    return typeof sel === 'function' ? sel(mockState) : mockState;
  };
  useAuthStore.getState = () => mockState;
  return { ...real, useAuthStore };
});

// ── Team store ────────────────────────────────────────────────────────────────
let currentTeams: Team[] = [];

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (sel?: (s: {
    teams: Team[];
    softDeleteTeam: () => void;
    hardDeleteTeam: () => void;
    addTeamToLeague: () => void;
    removeTeamFromLeague: () => void;
  }) => unknown) => {
    const state = {
      teams: currentTeams,
      softDeleteTeam: vi.fn(),
      hardDeleteTeam: vi.fn(),
      addTeamToLeague: vi.fn(),
      removeTeamFromLeague: vi.fn(),
    };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

// ── Player store ──────────────────────────────────────────────────────────────
vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (sel?: (s: { players: never[]; deletePlayersForTeam: () => void }) => unknown) => {
    const state = { players: [] as never[], deletePlayersForTeam: vi.fn() };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

// ── Event store ───────────────────────────────────────────────────────────────
vi.mock('@/store/useEventStore', () => ({
  useEventStore: (sel?: (s: {
    events: never[];
    addEvent?: () => void;
    updateEvent?: () => void;
    deleteEvent?: () => void;
  }) => unknown) => {
    const state = { events: [] as never[], addEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn() };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

// ── League store ──────────────────────────────────────────────────────────────
let currentLeagues: { id: string; name: string; sport?: string; season?: string; managedBy?: string; description?: string; managerIds?: string[] }[] = [];

vi.mock('@/store/useLeagueStore', () => ({
  useLeagueStore: (sel?: (s: {
    leagues: typeof currentLeagues;
    updateLeague: () => void;
    softDeleteLeague: () => void;
    addTeamToLeague: () => void;
    removeTeamFromLeague: () => void;
  }) => unknown) => {
    const state = {
      leagues: currentLeagues,
      updateLeague: vi.fn(),
      softDeleteLeague: vi.fn(),
      addTeamToLeague: vi.fn(),
      removeTeamFromLeague: vi.fn(),
    };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

// ── Availability store ────────────────────────────────────────────────────────
vi.mock('@/store/useAvailabilityStore', () => ({
  useAvailabilityStore: (sel: (s: { loadAvailability: () => () => void }) => unknown) =>
    sel({ loadAvailability: () => () => {} }),
}));

// ── Venue store ───────────────────────────────────────────────────────────────
vi.mock('@/store/useVenueStore', () => {
  const subscribe = vi.fn(() => () => {});
  const useVenueStore = (sel?: (s: { venues: never[]; subscribe: typeof subscribe }) => unknown) => {
    const state = { venues: [] as never[], subscribe };
    return typeof sel === 'function' ? sel(state) : state;
  };
  useVenueStore.getState = () => ({ venues: [] as never[], subscribe });
  return { useVenueStore };
});

// ── Season store ──────────────────────────────────────────────────────────────
const mockFetchSeasons = vi.fn(() => () => {});
vi.mock('@/store/useSeasonStore', () => {
  const useSeasonStore = (sel?: (s: { seasons: never[]; fetchSeasons: () => void }) => unknown) => {
    const state = { seasons: [] as never[], fetchSeasons: vi.fn() };
    return typeof sel === 'function' ? sel(state) : state;
  };
  useSeasonStore.getState = () => ({ fetchSeasons: mockFetchSeasons });
  return { useSeasonStore };
});

// ── Collection store ──────────────────────────────────────────────────────────
vi.mock('@/store/useCollectionStore', () => {
  const collectionState = {
    activeCollection: null,
    responses: [] as never[],
    wizardDraft: null,
    loadCollection: vi.fn(() => () => {}),
    loadWizardDraft: vi.fn(() => () => {}),
  };
  const useCollectionStore = (sel?: (s: typeof collectionState) => unknown) => {
    return typeof sel === 'function' ? sel(collectionState) : collectionState;
  };
  useCollectionStore.getState = () => collectionState;
  return { useCollectionStore };
});

// ── Notification store ────────────────────────────────────────────────────────
vi.mock('@/store/useNotificationStore', () => ({
  useNotificationStore: (sel: (s: { notifications: never[] }) => unknown) =>
    sel({ notifications: [] }),
}));

// ── Settings store ────────────────────────────────────────────────────────────
vi.mock('@/store/useSettingsStore', () => ({
  useSettingsStore: (sel: (s: { settings: { kidsSportsMode: boolean } }) => unknown) =>
    sel({ settings: { kidsSportsMode: false } }),
}));

// ── Feature flags ─────────────────────────────────────────────────────────────
vi.mock('@/lib/flags', () => ({
  FLAGS: { KIDS_MODE: false },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { AssignCoCoachModal } from '@/components/teams/AssignCoCoachModal';
import { AssignCoManagerModal } from '@/components/leagues/AssignCoManagerModal';
import { TeamDetailPage } from '@/pages/TeamDetailPage';
import { LeagueDetailPage } from '@/pages/LeagueDetailPage';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeProfile(role: UserProfile['role'], overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid-coach',
    email: 'coach@example.com',
    displayName: 'Coach User',
    role,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTeam(id = 'team-1', overrides: Partial<Team> = {}): Team {
  return {
    id,
    name: 'Red Hawks',
    sportType: 'soccer',
    color: '#1d4ed8',
    createdBy: 'uid-owner',
    ownerName: 'Team Owner',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeLeague(id = 'league-1', overrides: Partial<typeof currentLeagues[number]> = {}) {
  return { id, name: 'Spring League', ...overrides };
}

// ─── Render helpers ───────────────────────────────────────────────────────────

function renderCoCoachModal(props: { open?: boolean; onClose?: () => void; teamId?: string; teamName?: string } = {}) {
  const onClose = props.onClose ?? vi.fn();
  render(
    <AssignCoCoachModal
      open={props.open ?? true}
      onClose={onClose}
      teamId={props.teamId ?? 'team-1'}
      teamName={props.teamName ?? 'Red Hawks'}
    />
  );
  return { onClose };
}

function renderCoManagerModal(props: { open?: boolean; onClose?: () => void; leagueId?: string; leagueName?: string } = {}) {
  const onClose = props.onClose ?? vi.fn();
  render(
    <AssignCoManagerModal
      open={props.open ?? true}
      onClose={onClose}
      leagueId={props.leagueId ?? 'league-1'}
      leagueName={props.leagueName ?? 'Spring League'}
    />
  );
  return { onClose };
}

function renderTeamDetail(teamId = 'team-1') {
  return render(
    <MemoryRouter initialEntries={[`/teams/${teamId}`]}>
      <Routes>
        <Route path="/teams/:id" element={<TeamDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderLeagueDetail(leagueId = 'league-1') {
  return render(
    <MemoryRouter initialEntries={[`/leagues/${leagueId}`]}>
      <Routes>
        <Route path="/leagues/:id" element={<LeagueDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// ── Helper: navigate TeamDetailPage to Info tab ───────────────────────────────
function clickInfoTab() {
  const infoTab = screen.queryByRole('button', { name: /info/i });
  if (infoTab) fireEvent.click(infoTab);
}

// ─── Reset between tests ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
  currentTeams = [];
  currentLeagues = [];
  mockNavigate.mockReset();
  // Default: CF resolves successfully — individual tests override as needed
  mockCallableFn.mockResolvedValue({ data: { success: true, targetUid: 'uid-target', displayName: 'Jane Coach' } });
});

// =============================================================================
// AssignCoCoachModal
// =============================================================================

describe('AssignCoCoachModal — visibility', () => {
  it('renders the modal when open=true', () => {
    renderCoCoachModal({ open: true });
    expect(screen.getByRole('heading', { name: /add co-coach/i })).toBeInTheDocument();
  });

  it('renders nothing when open=false', () => {
    renderCoCoachModal({ open: false });
    expect(screen.queryByRole('heading', { name: /add co-coach/i })).not.toBeInTheDocument();
  });
});

describe('AssignCoCoachModal — validation', () => {
  it('shows a validation error when email is empty on submit', async () => {
    renderCoCoachModal();
    fireEvent.click(screen.getByRole('button', { name: /add co-coach/i }));
    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    });
  });

  it('does not call the CF when email is empty', async () => {
    renderCoCoachModal();
    fireEvent.click(screen.getByRole('button', { name: /add co-coach/i }));
    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    });
    expect(mockCallableFn).not.toHaveBeenCalled();
  });
});

describe('AssignCoCoachModal — successful submit', () => {
  it('calls the CF with email trimmed/lowercased, role=coach, and the teamId', async () => {
    renderCoCoachModal({ teamId: 'team-abc' });
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: '  JANE@Example.Com  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add co-coach/i }));
    await waitFor(() => {
      expect(mockCallableFn).toHaveBeenCalledWith({
        email: 'jane@example.com',
        role: 'coach',
        teamId: 'team-abc',
      });
    });
  });

  it('shows a success banner after the CF resolves', async () => {
    renderCoCoachModal();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add co-coach/i }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/jane coach.*co-coach.*red hawks/i);
    });
  });

  it('success banner includes displayName from CF result and the teamName prop', async () => {
    mockCallableFn.mockResolvedValue({ data: { success: true, targetUid: 'uid-t', displayName: 'Samantha Speedy' } });
    renderCoCoachModal({ teamName: 'Blue Thunder' });
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'sam@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add co-coach/i }));
    await waitFor(() => {
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent(/samantha speedy/i);
      expect(status).toHaveTextContent(/blue thunder/i);
    });
  });

  it('clears the email input after a successful submit', async () => {
    renderCoCoachModal();
    const emailInput = screen.getByLabelText(/email address/i);
    fireEvent.change(emailInput, { target: { value: 'jane@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /add co-coach/i }));
    // After success the form is replaced by the success view; the input is gone
    await waitFor(() => {
      expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    });
  });

  it('"Add Another" hides the success banner and shows the form again', async () => {
    renderCoCoachModal();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add co-coach/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add another/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /add another/i }));
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  it('"Done" calls onClose after success', async () => {
    const { onClose } = renderCoCoachModal();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add co-coach/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AssignCoCoachModal — error handling', () => {
  it('shows the error message returned by the CF', async () => {
    mockCallableFn.mockRejectedValue(new Error('No account found for email: unknown@example.com'));
    renderCoCoachModal();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'unknown@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add co-coach/i }));
    await waitFor(() => {
      expect(screen.getByText(/no account found for email/i)).toBeInTheDocument();
    });
  });

  it('does not show the success banner when the CF rejects', async () => {
    mockCallableFn.mockRejectedValue(new Error('Permission denied'));
    renderCoCoachModal();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add co-coach/i }));
    await waitFor(() => {
      expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /done/i })).not.toBeInTheDocument();
  });
});

describe('AssignCoCoachModal — cancel and reset', () => {
  it('calls onClose when Cancel is clicked', () => {
    const { onClose } = renderCoCoachModal();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clears prior error state when the modal is closed and reopened', async () => {
    mockCallableFn.mockRejectedValue(new Error('Something went wrong'));
    const onClose = vi.fn();
    const { rerender } = render(
      <AssignCoCoachModal open={true} onClose={onClose} teamId="team-1" teamName="Red Hawks" />
    );
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add co-coach/i }));
    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });

    // Close then reopen
    rerender(<AssignCoCoachModal open={false} onClose={onClose} teamId="team-1" teamName="Red Hawks" />);
    rerender(<AssignCoCoachModal open={true} onClose={onClose} teamId="team-1" teamName="Red Hawks" />);

    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });
});

// =============================================================================
// AssignCoManagerModal
// =============================================================================

describe('AssignCoManagerModal — visibility', () => {
  it('renders the modal when open=true', () => {
    renderCoManagerModal({ open: true });
    expect(screen.getByRole('heading', { name: /add co-manager/i })).toBeInTheDocument();
  });

  it('renders nothing when open=false', () => {
    renderCoManagerModal({ open: false });
    expect(screen.queryByRole('heading', { name: /add co-manager/i })).not.toBeInTheDocument();
  });
});

describe('AssignCoManagerModal — validation', () => {
  it('shows a validation error when email is empty on submit', async () => {
    renderCoManagerModal();
    fireEvent.click(screen.getByRole('button', { name: /add co-manager/i }));
    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    });
  });
});

describe('AssignCoManagerModal — successful submit', () => {
  it('calls the CF with email trimmed/lowercased, role=league_manager, and the leagueId', async () => {
    renderCoManagerModal({ leagueId: 'league-xyz' });
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: '  MARIA@Example.Com  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add co-manager/i }));
    await waitFor(() => {
      expect(mockCallableFn).toHaveBeenCalledWith({
        email: 'maria@example.com',
        role: 'league_manager',
        leagueId: 'league-xyz',
      });
    });
  });

  it('shows success banner with displayName and leagueName after success', async () => {
    mockCallableFn.mockResolvedValue({ data: { success: true, targetUid: 'uid-m', displayName: 'Maria Manager' } });
    renderCoManagerModal({ leagueName: 'Fall Cup' });
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'maria@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add co-manager/i }));
    await waitFor(() => {
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent(/maria manager/i);
      expect(status).toHaveTextContent(/fall cup/i);
    });
  });

  it('"Done" calls onClose after success', async () => {
    const { onClose } = renderCoManagerModal();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'maria@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add co-manager/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AssignCoManagerModal — error handling', () => {
  it('shows the error message when the CF rejects', async () => {
    mockCallableFn.mockRejectedValue(new Error('Only league managers can assign co-managers.'));
    renderCoManagerModal();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'anyone@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add co-manager/i }));
    await waitFor(() => {
      expect(screen.getByText(/only league managers can assign co-managers/i)).toBeInTheDocument();
    });
  });
});

describe('AssignCoManagerModal — cancel and reset', () => {
  it('calls onClose when Cancel is clicked', () => {
    const { onClose } = renderCoManagerModal();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// TeamDetailPage — "Add Co-Coach" button visibility
// =============================================================================

describe('TeamDetailPage Info tab — "Add Co-Coach" button visibility', () => {
  /**
   * The button lives inside the Info tab content. TeamDetailPage defaults to the
   * "schedule" tab on mount, so each test navigates to Info before asserting.
   */

  it('shows "Add Co-Coach" for a coach who has a membership scoped to this team', () => {
    currentTeams = [makeTeam('team-1')];
    currentProfile = makeProfile('coach', {
      uid: 'uid-coach',
      memberships: [{ role: 'coach', teamId: 'team-1', isPrimary: true }],
    });
    renderTeamDetail('team-1');
    clickInfoTab();
    expect(screen.getByRole('button', { name: /add co-coach/i })).toBeInTheDocument();
  });

  it('shows "Add Co-Coach" for a legacy owner (team.coachId === profile.uid)', () => {
    currentTeams = [makeTeam('team-1', { coachId: 'uid-coach', createdBy: 'uid-other' })];
    currentProfile = makeProfile('coach', { uid: 'uid-coach' });
    renderTeamDetail('team-1');
    clickInfoTab();
    expect(screen.getByRole('button', { name: /add co-coach/i })).toBeInTheDocument();
  });

  it('shows "Add Co-Coach" for the team creator (team.createdBy === profile.uid)', () => {
    currentTeams = [makeTeam('team-1', { createdBy: 'uid-coach' })];
    currentProfile = makeProfile('coach', { uid: 'uid-coach' });
    renderTeamDetail('team-1');
    clickInfoTab();
    expect(screen.getByRole('button', { name: /add co-coach/i })).toBeInTheDocument();
  });

  it('shows "Add Co-Coach" for an admin user', () => {
    currentTeams = [makeTeam('team-1')];
    currentProfile = makeProfile('admin', {
      uid: 'uid-admin',
      memberships: [{ role: 'admin', isPrimary: true }],
    });
    renderTeamDetail('team-1');
    clickInfoTab();
    expect(screen.getByRole('button', { name: /add co-coach/i })).toBeInTheDocument();
  });

  it('does NOT show "Add Co-Coach" for a plain player on the team', () => {
    currentTeams = [makeTeam('team-1')];
    currentProfile = makeProfile('player', {
      uid: 'uid-player',
      memberships: [{ role: 'player', teamId: 'team-1', isPrimary: true }],
    });
    renderTeamDetail('team-1');
    clickInfoTab();
    expect(screen.queryByRole('button', { name: /add co-coach/i })).not.toBeInTheDocument();
  });

  it('does NOT show "Add Co-Coach" when profile is null (unauthenticated)', () => {
    currentTeams = [makeTeam('team-1')];
    currentProfile = null;
    renderTeamDetail('team-1');
    // Page renders "Team not found" or empty — no co-coach button in any case
    expect(screen.queryByRole('button', { name: /add co-coach/i })).not.toBeInTheDocument();
  });
});

// =============================================================================
// LeagueDetailPage — "Add Co-Manager" button visibility
// =============================================================================

describe('LeagueDetailPage header — "Add Co-Manager" button visibility', () => {
  it('shows "Add Co-Manager" for a league_manager with a matching managed league', () => {
    currentLeagues = [makeLeague('league-1')];
    currentProfile = makeProfile('league_manager', {
      uid: 'uid-lm',
      memberships: [{ role: 'league_manager', leagueId: 'league-1', isPrimary: true }],
    });
    renderLeagueDetail('league-1');
    expect(screen.getByRole('button', { name: /add co-manager/i })).toBeInTheDocument();
  });

  it('shows "Add Co-Manager" when the league.managedBy field matches the profile uid', () => {
    currentLeagues = [makeLeague('league-1', { managedBy: 'uid-lm' })];
    currentProfile = makeProfile('league_manager', {
      uid: 'uid-lm',
      memberships: [{ role: 'league_manager', leagueId: 'league-OTHER', isPrimary: true }],
    });
    renderLeagueDetail('league-1');
    expect(screen.getByRole('button', { name: /add co-manager/i })).toBeInTheDocument();
  });

  it('shows "Add Co-Manager" for an admin user', () => {
    currentLeagues = [makeLeague('league-1')];
    currentProfile = makeProfile('admin', {
      uid: 'uid-admin',
      memberships: [{ role: 'admin', isPrimary: true }],
    });
    renderLeagueDetail('league-1');
    expect(screen.getByRole('button', { name: /add co-manager/i })).toBeInTheDocument();
  });

  it('does NOT show "Add Co-Manager" for a coach with no league_manager membership', () => {
    currentLeagues = [makeLeague('league-1')];
    currentProfile = makeProfile('coach', {
      uid: 'uid-coach',
      memberships: [{ role: 'coach', teamId: 'team-1', isPrimary: true }],
    });
    renderLeagueDetail('league-1');
    expect(screen.queryByRole('button', { name: /add co-manager/i })).not.toBeInTheDocument();
  });

  it('does NOT show "Add Co-Manager" for a league_manager scoped to a DIFFERENT league', () => {
    currentLeagues = [makeLeague('league-1')];
    currentProfile = makeProfile('league_manager', {
      uid: 'uid-lm',
      memberships: [{ role: 'league_manager', leagueId: 'league-OTHER', isPrimary: true }],
    });
    renderLeagueDetail('league-1');
    expect(screen.queryByRole('button', { name: /add co-manager/i })).not.toBeInTheDocument();
  });

  it('does NOT show "Add Co-Manager" when profile is null (unauthenticated)', () => {
    currentLeagues = [makeLeague('league-1')];
    currentProfile = null;
    renderLeagueDetail('league-1');
    expect(screen.queryByRole('button', { name: /add co-manager/i })).not.toBeInTheDocument();
  });
});
