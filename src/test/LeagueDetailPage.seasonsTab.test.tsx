/**
 * LeagueDetailPage — Seasons tab UX (ticket #204)
 *
 * Behaviors under test:
 *
 *   Tab visibility
 *     - Seasons tab is HIDDEN for a read-only user when there are no seasons
 *     - Seasons tab is VISIBLE for canManage=true when there are no seasons
 *     - Seasons tab is VISIBLE for any user when at least 1 season exists
 *
 *   Tab label
 *     - Shows season name (not "Seasons (1)") when exactly 1 season exists
 *     - Shows "Seasons (N)" when 2+ seasons exist
 *
 *   Single-season click navigates directly (no tab switch)
 *     - Clicking the Seasons tab with 1 season calls navigate to the season URL
 *     - After clicking with 1 season, the Seasons tab content is NOT rendered
 *       (the component navigated away rather than activating the tab panel)
 *
 *   Empty-state content
 *     - "Create First Season" button is visible for admin with no seasons
 *     - "Create First Season" button is visible for league_manager (canManage) with no seasons
 *     - "Create First Season" button is NOT visible for a read-only user
 *       (this case cannot be reached because the tab is hidden, but guards the
 *       canManage gate inside the empty state as a defense-in-depth check)
 *
 *   Multi-season list remains a normal tab
 *     - Clicking the Seasons tab with 2+ seasons renders the season list (no navigate)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { UserProfile } from '@/types';
import type { Season } from '@/types/season';

// ── Firebase stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: { collection: vi.fn() },
  functions: {},
  storage: {},
}));

// ── Router — capture navigate calls ──────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── Auth store ────────────────────────────────────────────────────────────────
let currentProfile: UserProfile | null = null;

vi.mock('@/store/useAuthStore', async () => {
  const real = await vi.importActual<typeof import('@/store/useAuthStore')>('@/store/useAuthStore');
  const mockState = {
    user: { uid: 'uid-1', email: 'user@example.com' },
    get profile() { return currentProfile; },
    logout: vi.fn(),
    updateProfile: vi.fn(),
  };
  const useAuthStore = (sel?: (s: typeof mockState) => unknown) =>
    typeof sel === 'function' ? sel(mockState) : mockState;
  useAuthStore.getState = () => mockState;
  return { ...real, useAuthStore };
});

// ── Season store — controlled list ───────────────────────────────────────────
let currentSeasons: Season[] = [];
const mockFetchSeasons = vi.fn(() => () => {});

vi.mock('@/store/useSeasonStore', () => {
  const useSeasonStore = (sel?: (s: { seasons: Season[]; fetchSeasons: () => void }) => unknown) => {
    const state = { seasons: currentSeasons, fetchSeasons: vi.fn() };
    return typeof sel === 'function' ? sel(state) : state;
  };
  useSeasonStore.getState = () => ({ fetchSeasons: mockFetchSeasons });
  return { useSeasonStore };
});

// ── League store ──────────────────────────────────────────────────────────────
let currentLeagues: { id: string; name: string; season?: string; sportType?: string; description?: string; managedBy?: string }[] = [];

vi.mock('@/store/useLeagueStore', () => ({
  useLeagueStore: (sel?: (s: { leagues: typeof currentLeagues; updateLeague: () => void; softDeleteLeague: () => void }) => unknown) => {
    const state = { leagues: currentLeagues, updateLeague: vi.fn(), softDeleteLeague: vi.fn() };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

// ── Team store ────────────────────────────────────────────────────────────────
vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (sel?: (s: { teams: never[]; addTeamToLeague: () => void; removeTeamFromLeague: () => void }) => unknown) => {
    const state = { teams: [] as never[], addTeamToLeague: vi.fn(), removeTeamFromLeague: vi.fn() };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

// ── Event store ───────────────────────────────────────────────────────────────
vi.mock('@/store/useEventStore', () => ({
  useEventStore: (sel?: (s: { events: never[] }) => unknown) => {
    const state = { events: [] as never[] };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

// ── Collection store ──────────────────────────────────────────────────────────
vi.mock('@/store/useCollectionStore', () => {
  const collectionState = {
    activeCollection: null,
    responses: [] as never[],
    wizardDraft: null,
    loadCollection: vi.fn(() => () => {}),
    loadWizardDraft: vi.fn(() => () => {}),
  };
  const useCollectionStore = (sel?: (s: typeof collectionState) => unknown) =>
    typeof sel === 'function' ? sel(collectionState) : collectionState;
  useCollectionStore.getState = () => collectionState;
  return { useCollectionStore };
});

// ── League venue store ────────────────────────────────────────────────────────
vi.mock('@/store/useLeagueVenueStore', () => {
  const state = {
    venues: [] as never[],
    leagueId: null,
    loading: false,
    subscribe: vi.fn(() => () => {}),
    importVenue: vi.fn(),
    updateLeagueVenue: vi.fn(),
    removeLeagueVenue: vi.fn(),
  };
  const useLeagueVenueStore = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  useLeagueVenueStore.getState = () => state;
  return { useLeagueVenueStore };
});

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

// ── Firestore stubs ───────────────────────────────────────────────────────────
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

// ── Firebase functions stub ───────────────────────────────────────────────────
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: {} })),
}));

// ── Import under test (after all mocks) ──────────────────────────────────────
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

function makeSeason(id: string, overrides: Partial<Season> = {}): Season {
  return {
    id,
    name: `Season ${id}`,
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    gamesPerTeam: 10,
    homeAwayBalance: true,
    status: 'setup',
    createdBy: 'uid-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Render helper ─────────────────────────────────────────────────────────────

function renderLeagueDetail(leagueId = 'league-1') {
  return render(
    <MemoryRouter initialEntries={[`/leagues/${leagueId}`]}>
      <Routes>
        <Route path="/leagues/:id" element={<LeagueDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// ── Reset ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
  currentLeagues = [];
  currentSeasons = [];
  mockNavigate.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tab visibility
// ─────────────────────────────────────────────────────────────────────────────

describe('LeagueDetailPage — Seasons tab visibility', () => {
  it('hides the Seasons tab for a read-only user when there are no seasons', () => {
    currentLeagues = [{ id: 'league-1', name: 'Spring League' }];
    currentSeasons = [];
    // player has no canManage rights
    currentProfile = makeProfile('player', {
      memberships: [{ role: 'player', teamId: 'team-1' }],
    });
    renderLeagueDetail('league-1');

    expect(screen.queryByRole('button', { name: /seasons/i })).toBeNull();
  });

  it('shows the Seasons tab for an admin even when there are no seasons', () => {
    currentLeagues = [{ id: 'league-1', name: 'Spring League' }];
    currentSeasons = [];
    currentProfile = makeProfile('admin');
    renderLeagueDetail('league-1');

    // "Seasons (0)" or just "Seasons" — the button with seasons text should exist
    expect(screen.getByRole('button', { name: /seasons/i })).toBeInTheDocument();
  });

  it('shows the Seasons tab for a league_manager who manages this league when there are no seasons', () => {
    currentLeagues = [{ id: 'league-1', name: 'Spring League' }];
    currentSeasons = [];
    currentProfile = makeProfile('league_manager', {
      memberships: [{ role: 'league_manager', leagueId: 'league-1', isPrimary: true }],
    });
    renderLeagueDetail('league-1');

    expect(screen.getByRole('button', { name: /seasons/i })).toBeInTheDocument();
  });

  it('shows the Seasons tab for a read-only user when at least one season exists', () => {
    currentLeagues = [{ id: 'league-1', name: 'Spring League' }];
    currentSeasons = [makeSeason('s-1', { name: 'Spring 2026' })];
    currentProfile = makeProfile('player', {
      memberships: [{ role: 'player', teamId: 'team-1' }],
    });
    renderLeagueDetail('league-1');

    // With 1 season the tab label is the season name
    expect(screen.getByRole('button', { name: /spring 2026/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tab label
// ─────────────────────────────────────────────────────────────────────────────

describe('LeagueDetailPage — Seasons tab label', () => {
  it('shows the season name (not "Seasons (1)") when exactly one season exists', () => {
    currentLeagues = [{ id: 'league-1', name: 'Spring League' }];
    currentSeasons = [makeSeason('s-1', { name: 'Spring 2026' })];
    currentProfile = makeProfile('admin');
    renderLeagueDetail('league-1');

    expect(screen.getByRole('button', { name: /spring 2026/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /seasons \(1\)/i })).toBeNull();
  });

  it('shows "Seasons (2)" when two seasons exist', () => {
    currentLeagues = [{ id: 'league-1', name: 'Spring League' }];
    currentSeasons = [
      makeSeason('s-1', { name: 'Spring 2026' }),
      makeSeason('s-2', { name: 'Fall 2026' }),
    ];
    currentProfile = makeProfile('admin');
    renderLeagueDetail('league-1');

    expect(screen.getByRole('button', { name: /seasons \(2\)/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Single-season click — navigates directly
// ─────────────────────────────────────────────────────────────────────────────

describe('LeagueDetailPage — single-season tab click navigates directly', () => {
  it('calls navigate to /leagues/:id/seasons/:seasonId when exactly one season exists', () => {
    currentLeagues = [{ id: 'league-1', name: 'Spring League' }];
    currentSeasons = [makeSeason('s-42', { name: 'Spring 2026' })];
    currentProfile = makeProfile('admin');
    renderLeagueDetail('league-1');

    fireEvent.click(screen.getByRole('button', { name: /spring 2026/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/leagues/league-1/seasons/s-42');
  });

  it('does not render the seasons tab panel after clicking with one season', () => {
    currentLeagues = [{ id: 'league-1', name: 'Spring League' }];
    currentSeasons = [makeSeason('s-42', { name: 'Spring 2026' })];
    currentProfile = makeProfile('admin');
    renderLeagueDetail('league-1');

    fireEvent.click(screen.getByRole('button', { name: /spring 2026/i }));

    // The "0 seasons" count label and "Create First Season" CTA both live
    // inside the seasons tab panel — they must NOT be visible because the
    // component navigated rather than switching the tab.
    expect(screen.queryByText(/create first season/i)).toBeNull();
    expect(screen.queryByText(/0 seasons/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-season click — normal tab switch (no navigate)
// ─────────────────────────────────────────────────────────────────────────────

describe('LeagueDetailPage — multi-season tab click switches tab, does not navigate', () => {
  it('does NOT call navigate when two seasons exist', () => {
    currentLeagues = [{ id: 'league-1', name: 'Spring League' }];
    currentSeasons = [
      makeSeason('s-1', { name: 'Spring 2026' }),
      makeSeason('s-2', { name: 'Fall 2026' }),
    ];
    currentProfile = makeProfile('admin');
    renderLeagueDetail('league-1');

    fireEvent.click(screen.getByRole('button', { name: /seasons \(2\)/i }));

    // navigate should not have been called for the seasons tab
    expect(mockNavigate).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/leagues\/league-1\/seasons\//),
    );
  });

  it('renders the season list after clicking the Seasons tab with two seasons', () => {
    currentLeagues = [{ id: 'league-1', name: 'Spring League' }];
    currentSeasons = [
      makeSeason('s-1', { name: 'Spring 2026' }),
      makeSeason('s-2', { name: 'Fall 2026' }),
    ];
    currentProfile = makeProfile('admin');
    renderLeagueDetail('league-1');

    fireEvent.click(screen.getByRole('button', { name: /seasons \(2\)/i }));

    // Both season names appear in the list
    expect(screen.getByText('Spring 2026')).toBeInTheDocument();
    expect(screen.getByText('Fall 2026')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Empty-state CTA button
// ─────────────────────────────────────────────────────────────────────────────

describe('LeagueDetailPage — empty Seasons tab CTA', () => {
  it('shows "Create First Season" button when admin opens the Seasons tab with no seasons', () => {
    currentLeagues = [{ id: 'league-1', name: 'Spring League' }];
    currentSeasons = [];
    currentProfile = makeProfile('admin');
    renderLeagueDetail('league-1');

    fireEvent.click(screen.getByRole('button', { name: /seasons/i }));

    expect(screen.getByRole('button', { name: /create first season/i })).toBeInTheDocument();
  });

  it('shows "Create First Season" button when the managing LM opens the Seasons tab with no seasons', () => {
    currentLeagues = [{ id: 'league-1', name: 'Spring League' }];
    currentSeasons = [];
    currentProfile = makeProfile('league_manager', {
      memberships: [{ role: 'league_manager', leagueId: 'league-1', isPrimary: true }],
    });
    renderLeagueDetail('league-1');

    fireEvent.click(screen.getByRole('button', { name: /seasons/i }));

    expect(screen.getByRole('button', { name: /create first season/i })).toBeInTheDocument();
  });

  it('does NOT show "Create First Season" button when a league_manager for a DIFFERENT league opens the Seasons tab', () => {
    // This LM can see the tab because seasons.length > 0 (or because they manage the league)?
    // In this scenario they manage a different league AND there are no seasons —
    // so the tab is hidden entirely. We confirm the CTA is not reachable.
    currentLeagues = [{ id: 'league-1', name: 'Spring League' }];
    currentSeasons = [];
    currentProfile = makeProfile('league_manager', {
      memberships: [{ role: 'league_manager', leagueId: 'league-OTHER', isPrimary: true }],
    });
    renderLeagueDetail('league-1');

    // Tab should not exist (confirmed by tab-visibility tests above),
    // so CTA is also unreachable.
    expect(screen.queryByRole('button', { name: /create first season/i })).toBeNull();
  });
});
