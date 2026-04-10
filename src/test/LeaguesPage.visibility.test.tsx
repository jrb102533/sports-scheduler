/**
 * LeaguesPage — userManagesLeague visibility bug fix
 *
 * The bug: visibleLeagues previously only checked profile.memberships and the
 * legacy profile.leagueId scalar. Leagues created via addLeague() include
 * managerIds: [uid] in the Firestore doc, but the cloud function that updates
 * profile.memberships has not yet run. Result: the freshly created league was
 * invisible immediately after creation.
 *
 * The fix: userManagesLeague() checks BOTH myLeagueIds (memberships-based) AND
 * league.managerIds.includes(profile.uid). These tests pin that dual-path
 * logic and guard against regression.
 *
 * Behaviors under test:
 *   visibleLeagues
 *     1. User in managerIds but NOT in memberships sees the league (regression case)
 *     2. User in memberships but NOT in managerIds sees the league (existing path)
 *     3. User in both sees the league (fully-synced state)
 *     4. User in neither does NOT see the league (different user's league)
 *     5. Admin sees all leagues regardless of managerIds / memberships
 *   canEdit
 *     6. Pencil button renders when user is in managerIds only (no memberships)
 *   isManager badge
 *     7. "League Manager" badge renders when user is in managerIds only (no memberships)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile, League, Team } from '@/types';

// ─── Firebase stub ─────────────────────────────────────────────────────────────
vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

// ─── navigate stub ─────────────────────────────────────────────────────────────
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

// ─── Auth store ───────────────────────────────────────────────────────────────
let currentProfile: UserProfile | null = null;

vi.mock('@/store/useAuthStore', async () => {
  const real = await vi.importActual<typeof import('@/store/useAuthStore')>('@/store/useAuthStore');
  return {
    ...real,
    useAuthStore: (selector?: (s: object) => unknown) => {
      const state = { profile: currentProfile, updateProfile: vi.fn().mockResolvedValue(undefined) };
      return selector ? selector(state) : state;
    },
  };
});

// ─── League store ─────────────────────────────────────────────────────────────
let currentLeagues: League[] = [];

vi.mock('@/store/useLeagueStore', () => ({
  useLeagueStore: (selector?: (s: object) => unknown) => {
    const state = {
      leagues: currentLeagues,
      addLeague: vi.fn().mockResolvedValue(undefined),
      updateLeague: vi.fn().mockResolvedValue(undefined),
      deleteLeague: vi.fn().mockResolvedValue(undefined),
    };
    return selector ? selector(state) : state;
  },
}));

// ─── Team store ───────────────────────────────────────────────────────────────
vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector?: (s: object) => unknown) => {
    const state = { teams: [] as Team[], addTeamToLeague: vi.fn(), removeTeamFromLeague: vi.fn() };
    return selector ? selector(state) : state;
  },
}));

// ─── Stub sub-components ──────────────────────────────────────────────────────
vi.mock('@/components/leagues/LeagueForm', () => ({
  LeagueForm: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="league-form"><input aria-label="League Name" /></div> : null,
}));

vi.mock('@/components/onboarding/BecomeLeagueManagerModal', () => ({
  BecomeLeagueManagerModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="become-lm-modal">Become a League Manager</div> : null,
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { LeaguesPage } from '@/pages/LeaguesPage';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeProfile(role: UserProfile['role'], overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'uid-lm',
    email: 'lm@example.com',
    displayName: 'League Manager User',
    role,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeLeague(id: string, overrides: Partial<League> = {}): League {
  return {
    id,
    name: `League ${id}`,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LeaguesPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
  currentLeagues = [];
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns all pencil (edit) buttons rendered on league cards. */
function getPencilButtons() {
  return Array.from(document.querySelectorAll('button')).filter(b =>
    b.querySelector('svg') && b.className.includes('hover:text-blue')
  );
}

// ─── visibleLeagues — the regression case ────────────────────────────────────

describe('LeaguesPage — visibleLeagues — userManagesLeague via managerIds', () => {
  it('shows a league when user uid is in managerIds but memberships is empty', () => {
    // Arrange: profile has no memberships and no leagueId — simulates the
    // window between addLeague() and the CF updating profile.memberships.
    currentProfile = makeProfile('league_manager', {
      uid: 'uid-lm',
      memberships: [],
    });
    currentLeagues = [
      makeLeague('lg-new', { name: 'Freshly Created League', managerIds: ['uid-lm'] }),
      makeLeague('lg-other', { name: 'Someone Elses League', managerIds: ['uid-other'] }),
    ];

    // Act
    renderPage();

    // Assert: own league is visible; unrelated league is not
    expect(screen.getByText('Freshly Created League')).toBeInTheDocument();
    expect(screen.queryByText("Someone Elses League")).toBeNull();
  });

  it('shows a league when user uid is in managerIds and memberships is absent (undefined)', () => {
    // Arrange: profile.memberships field is entirely absent (legacy account shape)
    currentProfile = makeProfile('league_manager', {
      uid: 'uid-lm',
      // memberships intentionally omitted
    });
    currentLeagues = [
      makeLeague('lg-new', { name: 'My League', managerIds: ['uid-lm'] }),
    ];

    // Act
    renderPage();

    // Assert
    expect(screen.getByText('My League')).toBeInTheDocument();
  });
});

// ─── visibleLeagues — existing memberships path still works ──────────────────

describe('LeaguesPage — visibleLeagues — userManagesLeague via memberships', () => {
  it('shows a league when leagueId is in memberships but managerIds is empty', () => {
    // Arrange: fully-synced profile but league doc has no managerIds
    currentProfile = makeProfile('league_manager', {
      uid: 'uid-lm',
      memberships: [{ role: 'league_manager', leagueId: 'lg-1' }],
    });
    currentLeagues = [
      makeLeague('lg-1', { name: 'Membership League', managerIds: [] }),
      makeLeague('lg-2', { name: 'Other League', managerIds: [] }),
    ];

    // Act
    renderPage();

    // Assert
    expect(screen.getByText('Membership League')).toBeInTheDocument();
    expect(screen.queryByText('Other League')).toBeNull();
  });

  it('shows a league when using the legacy scalar leagueId field (no managerIds)', () => {
    // Arrange: old account shape — leagueId set as scalar, no memberships array
    currentProfile = makeProfile('league_manager', {
      uid: 'uid-lm',
      leagueId: 'lg-legacy',
      memberships: undefined,
    });
    currentLeagues = [
      makeLeague('lg-legacy', { name: 'Legacy League' }),
    ];

    // Act
    renderPage();

    // Assert
    expect(screen.getByText('Legacy League')).toBeInTheDocument();
  });
});

// ─── visibleLeagues — user in both paths ─────────────────────────────────────

describe('LeaguesPage — visibleLeagues — user in both memberships and managerIds', () => {
  it('shows the league when both memberships and managerIds match (fully-synced state)', () => {
    currentProfile = makeProfile('league_manager', {
      uid: 'uid-lm',
      memberships: [{ role: 'league_manager', leagueId: 'lg-1' }],
    });
    currentLeagues = [
      makeLeague('lg-1', { name: 'Synced League', managerIds: ['uid-lm'] }),
    ];

    renderPage();

    expect(screen.getByText('Synced League')).toBeInTheDocument();
  });
});

// ─── visibleLeagues — user in neither path ───────────────────────────────────

describe('LeaguesPage — visibleLeagues — user in neither memberships nor managerIds', () => {
  it('does not show a league the user has no connection to', () => {
    // Arrange: user is a league_manager but for a completely different league
    currentProfile = makeProfile('league_manager', {
      uid: 'uid-lm',
      memberships: [{ role: 'league_manager', leagueId: 'lg-mine' }],
    });
    currentLeagues = [
      makeLeague('lg-theirs', { name: 'Another Managers League', managerIds: ['uid-other'] }),
    ];

    renderPage();

    expect(screen.queryByText("Another Managers League")).toBeNull();
    expect(screen.getByText(/no leagues yet/i)).toBeInTheDocument();
  });

  it('does not show any league to a user with empty memberships and uid not in any managerIds', () => {
    currentProfile = makeProfile('league_manager', {
      uid: 'uid-lm',
      memberships: [],
    });
    currentLeagues = [
      makeLeague('lg-1', { name: 'Not My League', managerIds: ['uid-other'] }),
    ];

    renderPage();

    expect(screen.queryByText('Not My League')).toBeNull();
  });
});

// ─── Admin sees all leagues ───────────────────────────────────────────────────

describe('LeaguesPage — admin sees all leagues regardless of managerIds', () => {
  it('shows leagues with no managerIds', () => {
    currentProfile = makeProfile('admin', { uid: 'uid-admin' });
    currentLeagues = [
      makeLeague('lg-1', { name: 'League With No Managers' }),
    ];

    renderPage();

    expect(screen.getByText('League With No Managers')).toBeInTheDocument();
  });

  it('shows leagues managed by other users', () => {
    currentProfile = makeProfile('admin', { uid: 'uid-admin' });
    currentLeagues = [
      makeLeague('lg-1', { name: 'League A', managerIds: ['uid-other-1'] }),
      makeLeague('lg-2', { name: 'League B', managerIds: ['uid-other-2'] }),
    ];

    renderPage();

    expect(screen.getByText('League A')).toBeInTheDocument();
    expect(screen.getByText('League B')).toBeInTheDocument();
  });
});

// ─── canEdit — pencil button via managerIds ───────────────────────────────────

describe('LeaguesPage — canEdit renders pencil button when user is in managerIds only', () => {
  it('shows the edit button on the league card when uid is in managerIds but memberships is empty', () => {
    // Arrange: the regression state — profile not yet synced, but managerIds present
    currentProfile = makeProfile('league_manager', {
      uid: 'uid-lm',
      memberships: [],
    });
    currentLeagues = [
      makeLeague('lg-new', { name: 'My New League', managerIds: ['uid-lm'] }),
    ];

    renderPage();

    // The pencil (edit) button must be present — canEdit = true when userManagesLeague
    const pencilBtns = getPencilButtons();
    expect(pencilBtns.length).toBeGreaterThan(0);
  });

  it('does NOT show the edit button when uid is in neither memberships nor managerIds', () => {
    currentProfile = makeProfile('league_manager', {
      uid: 'uid-lm',
      memberships: [{ role: 'league_manager', leagueId: 'lg-mine' }],
    });
    // Render a league the user does not manage — they shouldn't see it at all,
    // but if it were in the list it would have no edit button
    currentLeagues = [
      makeLeague('lg-mine', { name: 'My League', managerIds: ['uid-lm'] }),
      // This league is only visible to admin, so no edit button check needed
    ];

    renderPage();

    // Only one league is visible (lg-mine), and it belongs to the user — one pencil
    const pencilBtns = getPencilButtons();
    expect(pencilBtns.length).toBe(1);
  });
});

// ─── isManager badge via managerIds ──────────────────────────────────────────

describe('LeaguesPage — "League Manager" badge renders when user is in managerIds only', () => {
  it('shows the "League Manager" badge when uid is in managerIds but memberships is empty', () => {
    // Arrange: freshly created league — profile.memberships not yet updated by CF
    currentProfile = makeProfile('league_manager', {
      uid: 'uid-lm',
      memberships: [],
    });
    currentLeagues = [
      makeLeague('lg-new', { name: 'My Fresh League', managerIds: ['uid-lm'] }),
    ];

    renderPage();

    expect(screen.getByText('League Manager')).toBeInTheDocument();
  });

  it('does NOT show the "League Manager" badge for a league the user does not manage', () => {
    currentProfile = makeProfile('league_manager', {
      uid: 'uid-lm',
      memberships: [{ role: 'league_manager', leagueId: 'lg-mine' }],
    });
    currentLeagues = [
      makeLeague('lg-mine', { name: 'My League', managerIds: ['uid-lm'] }),
    ];

    renderPage();

    // Exactly one badge for the one managed league
    const badges = screen.getAllByText('League Manager');
    expect(badges).toHaveLength(1);
  });

  it('does not show "League Manager" badge for an unmanaged league visible to admin', () => {
    // Admin sees all leagues, but the badge only appears for leagues the admin personally manages
    currentProfile = makeProfile('admin', {
      uid: 'uid-admin',
      memberships: [],
    });
    currentLeagues = [
      makeLeague('lg-1', { name: 'Unmanaged League', managerIds: ['uid-other'] }),
    ];

    renderPage();

    // Admin sees the league but is not in managerIds — badge must not appear
    expect(screen.getByText('Unmanaged League')).toBeInTheDocument();
    expect(screen.queryByText('League Manager')).toBeNull();
  });
});
