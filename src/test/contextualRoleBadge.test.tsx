/**
 * contextualRoleBadge.test.tsx
 *
 * Covers the contextual role badge added to TeamDetailPage and LeagueDetailPage
 * in PR #285 (feat/contextual-role-display).
 *
 * TeamDetailPage badge (getMemberships(profile).find(m => m.teamId === teamId))
 *   - shows coach badge when user has a coach membership on the current team
 *   - shows player badge when user has a player membership on the current team
 *   - shows parent badge when user has a parent membership on the current team
 *   - shows league_manager badge when LM has a membership pointing at this team
 *   - badge label uses role with underscore replaced by space (league_manager → league manager)
 *   - admin with no teamId membership on this team shows NO badge
 *   - user with membership on a DIFFERENT team shows NO badge for this team
 *   - user with null profile shows NO badge (getMemberships(null) returns [])
 *   - legacy user with profile.role=coach and no memberships array shows coach badge
 *     (via getMemberships legacy fallback — only when profile.teamId matches)
 *
 * LeagueDetailPage badge (getMemberships(profile ?? null).find(m => m.leagueId === id && m.role === 'league_manager'))
 *   - shows "League Manager" badge when user has a league_manager membership for the current league
 *   - does NOT show badge for a league_manager membership on a DIFFERENT league
 *   - admin with no league_manager membership shows NO badge
 *   - coach user (no league_manager membership) shows NO badge
 *   - user with null profile shows NO badge
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { UserProfile, Team } from '@/types';

// ── Firebase stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {
    collection: vi.fn(),
  },
  functions: {},
  storage: {},
}));

// ── Router ────────────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── Auth store (selector pattern — TeamDetailPage + LeagueDetailPage both use selectors) ──
let currentProfile: UserProfile | null = null;

vi.mock('@/store/useAuthStore', async () => {
  const real = await vi.importActual<typeof import('@/store/useAuthStore')>('@/store/useAuthStore');
  const mockState = {
    user: { uid: 'uid-1', email: 'user@example.com' },
    get profile() { return currentProfile; },
    logout: vi.fn(),
    updateProfile: vi.fn(),
  };
  const useAuthStore = (sel?: (s: typeof mockState) => unknown) => {
    return typeof sel === 'function' ? sel(mockState) : mockState;
  };
  // Attach getState so stores that call useAuthStore.getState() work
  useAuthStore.getState = () => mockState;
  return {
    ...real,
    useAuthStore,
  };
});

// ── Team store ────────────────────────────────────────────────────────────────
let currentTeams: Team[] = [];

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (sel?: (s: { teams: Team[]; softDeleteTeam: () => void; hardDeleteTeam: () => void; addTeamToLeague: () => void; removeTeamFromLeague: () => void }) => unknown) => {
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
  useEventStore: (sel?: (s: { events: never[]; addEvent?: () => void; updateEvent?: () => void; deleteEvent?: () => void }) => unknown) => {
    const state = { events: [] as never[], addEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn() };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

// ── League store ──────────────────────────────────────────────────────────────
let currentLeagues: { id: string; name: string; sport?: string; season?: string; managedBy?: string; description?: string }[] = [];

vi.mock('@/store/useLeagueStore', () => ({
  useLeagueStore: (sel?: (s: { leagues: typeof currentLeagues; updateLeague: () => void; softDeleteLeague: () => void; addTeamToLeague: () => void; removeTeamFromLeague: () => void }) => unknown) => {
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

// ── Firestore (getDocs, query, collection, where stubs) ───────────────────────
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

// ── Firebase functions (httpsCallable stub) ───────────────────────────────────
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: {} })),
}));

// ── Import components after mocks ─────────────────────────────────────────────
import { TeamDetailPage } from '@/pages/TeamDetailPage';
import { LeagueDetailPage } from '@/pages/LeagueDetailPage';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeProfile(role: UserProfile['role'], overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid-1',
    email: 'user@example.com',
    displayName: 'Test User',
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
    createdBy: 'uid-1',
    ownerName: 'Test User',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeLeague(id = 'league-1', overrides: Partial<typeof currentLeagues[number]> = {}) {
  return {
    id,
    name: 'Spring League',
    ...overrides,
  };
}

// ── Render helpers ────────────────────────────────────────────────────────────

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

// ── Reset ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
  currentTeams = [];
  currentLeagues = [];
  mockNavigate.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// TeamDetailPage — contextual role badge
// ─────────────────────────────────────────────────────────────────────────────

describe('TeamDetailPage — contextual role badge', () => {
  it('shows "coach" badge when user has a coach membership on the current team', () => {
    currentTeams = [makeTeam('team-1')];
    currentProfile = makeProfile('coach', {
      memberships: [{ role: 'coach', teamId: 'team-1', isPrimary: true }],
    });
    renderTeamDetail('team-1');

    expect(screen.getByText('coach')).toBeTruthy();
  });

  it('shows "player" badge when user has a player membership on the current team', () => {
    currentTeams = [makeTeam('team-1')];
    currentProfile = makeProfile('player', {
      memberships: [{ role: 'player', teamId: 'team-1', isPrimary: true }],
    });
    renderTeamDetail('team-1');

    expect(screen.getByText('player')).toBeTruthy();
  });

  it('shows "parent" badge when user has a parent membership on the current team', () => {
    currentTeams = [makeTeam('team-1')];
    currentProfile = makeProfile('parent', {
      memberships: [{ role: 'parent', teamId: 'team-1', isPrimary: true }],
    });
    renderTeamDetail('team-1');

    expect(screen.getByText('parent')).toBeTruthy();
  });

  it('renders "league manager" (underscore replaced) for a league_manager membership pointing at this team', () => {
    currentTeams = [makeTeam('team-1')];
    currentProfile = makeProfile('league_manager', {
      memberships: [{ role: 'league_manager', teamId: 'team-1', leagueId: 'l1', isPrimary: true }],
    });
    renderTeamDetail('team-1');

    expect(screen.getByText('league manager')).toBeTruthy();
  });

  it('shows NO badge for an admin who has no teamId membership on the current team', () => {
    currentTeams = [makeTeam('team-1')];
    currentProfile = makeProfile('admin', {
      // Admin membership has no teamId
      memberships: [{ role: 'admin', isPrimary: true }],
    });
    renderTeamDetail('team-1');

    // Badge text is the role — none of these should appear
    expect(screen.queryByText('admin')).toBeNull();
    expect(screen.queryByText('coach')).toBeNull();
  });

  it('shows NO badge when user has a membership on a DIFFERENT team', () => {
    currentTeams = [makeTeam('team-1')];
    currentProfile = makeProfile('coach', {
      memberships: [{ role: 'coach', teamId: 'team-OTHER', isPrimary: true }],
    });
    renderTeamDetail('team-1');

    expect(screen.queryByText('coach')).toBeNull();
  });

  it('shows NO badge when profile is null', () => {
    currentTeams = [makeTeam('team-1')];
    currentProfile = null;
    renderTeamDetail('team-1');

    // Page should render a "Team not found" or login redirect — no badge
    expect(screen.queryByText('coach')).toBeNull();
    expect(screen.queryByText('player')).toBeNull();
    expect(screen.queryByText('parent')).toBeNull();
  });

  it('shows coach badge for a legacy user (profile.role=coach, no memberships array, profile.teamId matches)', () => {
    currentTeams = [makeTeam('team-1')];
    currentProfile = makeProfile('coach', { teamId: 'team-1' });
    // No memberships array — getMemberships falls back to legacy scalar
    delete (currentProfile as Partial<UserProfile>).memberships;
    renderTeamDetail('team-1');

    expect(screen.getByText('coach')).toBeTruthy();
  });

  it('shows NO badge for a legacy user whose legacy teamId does NOT match the current team', () => {
    currentTeams = [makeTeam('team-1')];
    currentProfile = makeProfile('coach', { teamId: 'team-OTHER' });
    delete (currentProfile as Partial<UserProfile>).memberships;
    renderTeamDetail('team-1');

    expect(screen.queryByText('coach')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LeagueDetailPage — contextual role badge
// ─────────────────────────────────────────────────────────────────────────────

describe('LeagueDetailPage — contextual League Manager badge', () => {
  it('shows "League Manager" badge when user has a league_manager membership for the current league', () => {
    currentLeagues = [makeLeague('league-1')];
    currentProfile = makeProfile('league_manager', {
      memberships: [{ role: 'league_manager', leagueId: 'league-1', isPrimary: true }],
    });
    renderLeagueDetail('league-1');

    expect(screen.getByText('League Manager')).toBeTruthy();
  });

  it('does NOT show badge for a league_manager membership on a DIFFERENT league', () => {
    currentLeagues = [makeLeague('league-1')];
    currentProfile = makeProfile('league_manager', {
      memberships: [{ role: 'league_manager', leagueId: 'league-OTHER', isPrimary: true }],
    });
    renderLeagueDetail('league-1');

    expect(screen.queryByText('League Manager')).toBeNull();
  });

  it('does NOT show badge for an admin who has no league_manager membership', () => {
    currentLeagues = [makeLeague('league-1')];
    currentProfile = makeProfile('admin', {
      memberships: [{ role: 'admin', isPrimary: true }],
    });
    renderLeagueDetail('league-1');

    expect(screen.queryByText('League Manager')).toBeNull();
  });

  it('does NOT show badge for a coach user with no league_manager membership', () => {
    currentLeagues = [makeLeague('league-1')];
    currentProfile = makeProfile('coach', {
      memberships: [{ role: 'coach', teamId: 'team-1', isPrimary: true }],
    });
    renderLeagueDetail('league-1');

    expect(screen.queryByText('League Manager')).toBeNull();
  });

  it('does NOT show badge when profile is null', () => {
    currentLeagues = [makeLeague('league-1')];
    currentProfile = null;
    renderLeagueDetail('league-1');

    expect(screen.queryByText('League Manager')).toBeNull();
  });

  it('shows badge when user holds both coach and league_manager memberships (multi-role)', () => {
    currentLeagues = [makeLeague('league-1')];
    currentProfile = makeProfile('coach', {
      role: 'coach',
      memberships: [
        { role: 'coach', teamId: 'team-1', isPrimary: true },
        { role: 'league_manager', leagueId: 'league-1' },
      ],
    });
    renderLeagueDetail('league-1');

    expect(screen.getByText('League Manager')).toBeTruthy();
  });
});
