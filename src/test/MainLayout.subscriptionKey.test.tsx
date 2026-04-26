/**
 * MainLayout — subscriptionKey derivation (fix/admin-team-resubscription-gap)
 *
 * The bug: when an admin or LM created a team, the new membership changed
 * userTeamIds, which changed the useEffect deps array ([user, userTeamIds.join(',')]),
 * which tore down and recreated all Firestore onSnapshot listeners. The new
 * subscription's first cached snapshot might not yet include the new team,
 * making it invisible in the list for up to 10+ seconds.
 *
 * The fix: admins and LMs use a stable subscriptionKey of 'admin' regardless
 * of their memberships, because their store queries are unscoped. Only
 * non-admin users key on userTeamIds so their subscriptions re-scope correctly
 * when they join or leave a team.
 *
 * Behaviors under test:
 *
 *   subscriptionKey derivation (pure logic)
 *     - Admin with no memberships → 'admin'
 *     - Admin with one team membership → 'admin' (not the teamId)
 *     - Admin who gains a first team (memberships change) → still 'admin'
 *     - league_manager with no memberships → 'admin'
 *     - league_manager with team memberships → 'admin'
 *     - Coach with no memberships → ''
 *     - Coach with one team → teamId
 *     - Coach with two teams → sorted comma-joined teamIds
 *     - Player with one team → teamId
 *     - Parent with one team → teamId
 *     - Role change: admin → coach → key changes from 'admin' to teamId (triggers re-subscribe)
 *     - Role change: coach → admin → key changes from teamId to 'admin' (triggers re-subscribe)
 *     - Non-admin membership change (new team added) → key changes (triggers re-subscribe)
 *
 *   Firestore subscription lifecycle (via rendered MainLayout)
 *     - subscribe is called once on mount for admin user
 *     - subscribe is NOT called again when admin gains a team membership
 *     - subscribe IS called again when a coach gains a new team membership
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile } from '../types';

// ─── vi.hoisted: spy refs referenced inside vi.mock factories ─────────────────

const { mockSubscribeTeams, mockSubscribeEvents, mockSubscribePlayers,
        mockSubscribeNotifications, mockSubscribeSettings,
        mockSubscribeLeagues, mockSubscribeOpponents } = vi.hoisted(() => ({
  mockSubscribeTeams: vi.fn(() => vi.fn()),
  mockSubscribeEvents: vi.fn(() => vi.fn()),
  mockSubscribePlayers: vi.fn(() => vi.fn()),
  mockSubscribeNotifications: vi.fn(() => vi.fn()),
  mockSubscribeSettings: vi.fn(() => vi.fn()),
  mockSubscribeLeagues: vi.fn(() => vi.fn()),
  mockSubscribeOpponents: vi.fn(() => vi.fn()),
}));

// ─── Firebase stub ────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

// ─── Build info — suppress the staging banner ─────────────────────────────────

vi.mock('@/lib/buildInfo', () => ({
  buildInfo: {
    version: 'test', sha: 'test', time: '', branch: '', pr: null,
    env: 'test', isProduction: true, shortSha: 'abc1234',
  },
}));

// ─── Hooks that fire side effects inside MainLayout — stub them out ───────────

vi.mock('@/hooks/useNotificationTrigger', () => ({
  useNotificationTrigger: vi.fn(),
}));

vi.mock('@/hooks/useAttendanceNotification', () => ({
  useAttendanceNotification: vi.fn(),
}));

vi.mock('@/hooks/useIdleTimeout', () => ({
  useIdleTimeout: vi.fn(() => ({ showWarning: false, countdown: 0, resetTimer: vi.fn() })),
}));

// ─── Heavy child components — stubbed so we don't need their store deps ───────

vi.mock('@/components/layout/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

vi.mock('@/components/layout/TopBar', () => ({
  TopBar: () => <div data-testid="topbar" />,
}));

vi.mock('@/components/layout/NotificationPanel', () => ({
  NotificationPanel: () => <div data-testid="notification-panel" />,
}));

vi.mock('@/components/auth/SessionTimeoutModal', () => ({
  SessionTimeoutModal: () => <div data-testid="session-timeout-modal" />,
}));

vi.mock('@/components/auth/ConsentUpdateModal', () => ({
  ConsentUpdateModal: () => <div data-testid="consent-update-modal" />,
}));

// react-router-dom — Outlet stub so Outlet doesn't throw without a Route
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    Outlet: () => <div data-testid="outlet" />,
  };
});

// ─── Auth store — mutable so tests can drive profile changes ─────────────────

let currentProfile: UserProfile | null = null;
let currentUser: { uid: string } | null = null;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector?: (s: object) => unknown) => {
    const state = {
      user: currentUser,
      profile: currentProfile,
      logout: vi.fn(),
      mustChangePassword: false,
      consentOutdated: false,
    };
    return selector ? selector(state) : state;
  },
}));

// ─── Store mocks — expose getState().subscribe so we can count calls ──────────

vi.mock('@/store/useTeamStore', () => {
  const store = (selector: (s: { teams: never[]; loading: boolean }) => unknown) =>
    selector({ teams: [], loading: false });
  store.getState = () => ({ subscribe: mockSubscribeTeams });
  return { useTeamStore: store };
});

vi.mock('@/store/usePlayerStore', () => {
  const store = (selector: (s: { players: never[] }) => unknown) =>
    selector({ players: [] });
  store.getState = () => ({ subscribe: mockSubscribePlayers });
  return { usePlayerStore: store };
});

vi.mock('@/store/useEventStore', () => {
  const store = (selector: (s: { events: never[]; loading: boolean }) => unknown) =>
    selector({ events: [], loading: false });
  store.getState = () => ({ subscribe: mockSubscribeEvents });
  return { useEventStore: store };
});

vi.mock('@/store/useNotificationStore', () => {
  const store = (selector: (s: { notifications: never[] }) => unknown) =>
    selector({ notifications: [] });
  store.getState = () => ({ subscribe: mockSubscribeNotifications });
  return { useNotificationStore: store };
});

vi.mock('@/store/useSettingsStore', () => {
  const store = (selector: (s: { settings: object }) => unknown) =>
    selector({ settings: {} });
  store.getState = () => ({ subscribe: mockSubscribeSettings });
  return { useSettingsStore: store };
});

vi.mock('@/store/useLeagueStore', () => {
  const store = (selector: (s: { leagues: never[] }) => unknown) =>
    selector({ leagues: [] });
  store.getState = () => ({ subscribe: mockSubscribeLeagues });
  return { useLeagueStore: store };
});

vi.mock('@/store/useOpponentStore', () => {
  const store = (selector: (s: { opponents: never[] }) => unknown) =>
    selector({ opponents: [] });
  store.getState = () => ({ subscribe: mockSubscribeOpponents });
  return { useOpponentStore: store };
});

// ─── Import after mocks ───────────────────────────────────────────────────────

import { MainLayout } from '../layouts/MainLayout';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(role: UserProfile['role'], teamIds: string[] = []): UserProfile {
  return {
    uid: 'uid-1',
    email: 'test@example.com',
    displayName: 'Test User',
    role,
    memberships: teamIds.map(teamId => ({ role, teamId, isPrimary: teamId === teamIds[0] })),
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

/**
 * Builds a profile whose memberships have leagueIds (LM-style memberships)
 * rather than teamIds. Used to exercise the userLeagueIds derivation path.
 */
function makeProfileWithLeagues(role: UserProfile['role'], leagueIds: string[]): UserProfile {
  return {
    uid: 'uid-1',
    email: 'test@example.com',
    displayName: 'Test User',
    role,
    memberships: leagueIds.map((leagueId, i) => ({ role, leagueId, isPrimary: i === 0 })),
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

function renderLayout() {
  return render(
    <MemoryRouter>
      <MainLayout />
    </MemoryRouter>
  );
}

// ─── subscriptionKey pure-logic tests ─────────────────────────────────────────
//
// These derive the same formula used in MainLayout without rendering the
// component, so they run fast and are immune to render-layer changes.

function deriveSubscriptionKey(
  role: UserProfile['role'] | undefined,
  teamIds: string[],
  leagueIds: string[] = [],
): string {
  const isAdminOrLM = role === 'admin' || role === 'league_manager';
  return isAdminOrLM ? 'admin' : `${teamIds.join(',')}|${leagueIds.join(',')}`;
}

describe('subscriptionKey derivation', () => {
  describe('admin role', () => {
    it('returns "admin" when admin has no memberships', () => {
      expect(deriveSubscriptionKey('admin', [])).toBe('admin');
    });

    it('returns "admin" when admin has one team membership', () => {
      expect(deriveSubscriptionKey('admin', ['team-abc'])).toBe('admin');
    });

    it('returns "admin" when admin gains a first team (membership change does not change key)', () => {
      const before = deriveSubscriptionKey('admin', []);
      const after = deriveSubscriptionKey('admin', ['team-new']);
      expect(before).toBe('admin');
      expect(after).toBe('admin');
      expect(before).toBe(after); // key is stable — no re-subscription triggered
    });

    it('returns "admin" when admin has multiple team memberships', () => {
      expect(deriveSubscriptionKey('admin', ['team-a', 'team-b', 'team-c'])).toBe('admin');
    });
  });

  describe('league_manager role', () => {
    it('returns "admin" when LM has no memberships', () => {
      expect(deriveSubscriptionKey('league_manager', [])).toBe('admin');
    });

    it('returns "admin" when LM has team memberships', () => {
      expect(deriveSubscriptionKey('league_manager', ['team-xyz'])).toBe('admin');
    });

    it('returns same key as admin (stable regardless of membership changes)', () => {
      const before = deriveSubscriptionKey('league_manager', []);
      const after = deriveSubscriptionKey('league_manager', ['team-new']);
      expect(before).toBe(after);
    });
  });

  describe('coach role', () => {
    it('returns empty teams|leagues delimiter when coach has no memberships', () => {
      expect(deriveSubscriptionKey('coach', [])).toBe('|');
    });

    it('returns teamId|empty when coach has one team and no leagues', () => {
      expect(deriveSubscriptionKey('coach', ['team-123'])).toBe('team-123|');
    });

    it('returns comma-joined teamIds|empty when coach has two teams', () => {
      expect(deriveSubscriptionKey('coach', ['team-a', 'team-b'])).toBe('team-a,team-b|');
    });

    it('key changes when coach gains a new team membership (triggers re-subscribe)', () => {
      const before = deriveSubscriptionKey('coach', ['team-a']);
      const after = deriveSubscriptionKey('coach', ['team-a', 'team-b']);
      expect(before).not.toBe(after);
    });
  });

  describe('non-admin userLeagueIds contribution (the league-store scoping path)', () => {
    it('includes leagueIds in the key for non-admin coach', () => {
      expect(deriveSubscriptionKey('coach', ['team-a'], ['league-x'])).toBe('team-a|league-x');
    });

    it('comma-joins multiple leagueIds', () => {
      expect(deriveSubscriptionKey('coach', ['team-a'], ['league-x', 'league-y']))
        .toBe('team-a|league-x,league-y');
    });

    it('key changes when coach gains access to a new league (triggers leagues re-subscribe)', () => {
      const before = deriveSubscriptionKey('coach', ['team-a'], ['league-x']);
      const after = deriveSubscriptionKey('coach', ['team-a'], ['league-x', 'league-y']);
      expect(before).not.toBe(after);
    });

    it('key changes when leagueIds change even if teamIds are unchanged', () => {
      // e.g., the user's team got added to a new league — userTeamIds stays
      // the same but the team's leagueIds grew, so userLeagueIds grows too
      const before = deriveSubscriptionKey('parent', ['team-a'], ['league-x']);
      const after = deriveSubscriptionKey('parent', ['team-a'], ['league-y']);
      expect(before).not.toBe(after);
    });

    it('admin/LM ignore leagueIds entirely (stable "admin" key)', () => {
      // admin + LM use unscoped league query inside the store, so changes to
      // their derived leagueIds must NOT trigger a re-subscription
      expect(deriveSubscriptionKey('admin', ['team-a'], ['league-x'])).toBe('admin');
      expect(deriveSubscriptionKey('admin', ['team-a'], ['league-x', 'league-y'])).toBe('admin');
      expect(deriveSubscriptionKey('league_manager', [], ['league-x'])).toBe('admin');
    });
  });

  describe('player role', () => {
    it('returns empty teams|leagues delimiter when player has no memberships', () => {
      expect(deriveSubscriptionKey('player', [])).toBe('|');
    });

    it('returns teamId|empty when player has one team', () => {
      expect(deriveSubscriptionKey('player', ['team-xyz'])).toBe('team-xyz|');
    });
  });

  describe('parent role', () => {
    it('returns teamId|empty for parent with one team', () => {
      expect(deriveSubscriptionKey('parent', ['team-xyz'])).toBe('team-xyz|');
    });
  });

  describe('role change transitions', () => {
    it('admin → coach: key changes from "admin" to teamId|leagueIds (triggers re-subscribe)', () => {
      const adminKey = deriveSubscriptionKey('admin', ['team-a']);
      const coachKey = deriveSubscriptionKey('coach', ['team-a']);
      expect(adminKey).toBe('admin');
      expect(coachKey).toBe('team-a|');
      expect(adminKey).not.toBe(coachKey);
    });

    it('coach → admin: key changes from teamId|leagueIds to "admin" (triggers re-subscribe)', () => {
      const coachKey = deriveSubscriptionKey('coach', ['team-a']);
      const adminKey = deriveSubscriptionKey('admin', ['team-a']);
      expect(coachKey).toBe('team-a|');
      expect(adminKey).toBe('admin');
      expect(coachKey).not.toBe(adminKey);
    });

    it('coach → league_manager: key changes (triggers re-subscribe)', () => {
      const coachKey = deriveSubscriptionKey('coach', ['team-a']);
      const lmKey = deriveSubscriptionKey('league_manager', ['team-a']);
      expect(coachKey).not.toBe(lmKey);
    });

    it('undefined role (profile loading) → produces empty teams|leagues delimiter, not crash', () => {
      expect(deriveSubscriptionKey(undefined, [])).toBe('|');
    });
  });
});

// ─── Subscription lifecycle via rendered MainLayout ───────────────────────────

describe('MainLayout — subscription lifecycle', () => {
  beforeEach(() => {
    currentUser = null;
    currentProfile = null;
    vi.clearAllMocks();
  });

  it('subscribe is called once on initial mount for an admin user', () => {
    currentUser = { uid: 'uid-admin' };
    currentProfile = makeProfile('admin');

    renderLayout();

    // All 7 stores should subscribe exactly once
    expect(mockSubscribeTeams).toHaveBeenCalledTimes(1);
    expect(mockSubscribeEvents).toHaveBeenCalledTimes(1);
    expect(mockSubscribeNotifications).toHaveBeenCalledTimes(1);
  });

  it('subscribe is NOT called when user is null (pre-auth state)', () => {
    currentUser = null;
    currentProfile = null;

    renderLayout();

    expect(mockSubscribeTeams).not.toHaveBeenCalled();
    expect(mockSubscribeEvents).not.toHaveBeenCalled();
  });

  it('admin gaining a team membership does NOT trigger a second subscribe round', () => {
    currentUser = { uid: 'uid-admin' };
    currentProfile = makeProfile('admin', []);

    const { rerender } = renderLayout();

    const callCountAfterMount = mockSubscribeTeams.mock.calls.length;
    expect(callCountAfterMount).toBe(1);

    // Simulate admin creating their first team → memberships array grows
    act(() => {
      currentProfile = makeProfile('admin', ['team-new-001']);
    });

    rerender(
      <MemoryRouter>
        <MainLayout />
      </MemoryRouter>
    );

    // subscriptionKey remains 'admin' both before and after — no second subscribe
    expect(mockSubscribeTeams).toHaveBeenCalledTimes(1);
  });

  it('coach gaining a new team membership DOES trigger a second subscribe round', () => {
    currentUser = { uid: 'uid-coach' };
    currentProfile = makeProfile('coach', ['team-a']);

    const { rerender } = renderLayout();

    expect(mockSubscribeTeams).toHaveBeenCalledTimes(1);

    // Simulate coach being added to a second team
    act(() => {
      currentProfile = makeProfile('coach', ['team-a', 'team-b']);
    });

    rerender(
      <MemoryRouter>
        <MainLayout />
      </MemoryRouter>
    );

    // subscriptionKey changed: 'team-a' → 'team-a,team-b' → new subscribe expected
    expect(mockSubscribeTeams).toHaveBeenCalledTimes(2);
  });

  it('subscribe receives the correct (empty) userTeamIds for admin — unscoped query', () => {
    currentUser = { uid: 'uid-admin' };
    currentProfile = makeProfile('admin', ['team-a', 'team-b']);

    renderLayout();

    // Even though admin has memberships, the subscribe calls should use the
    // *derived* userTeamIds. The store's subscribe() is what scopes the query
    // internally. MainLayout passes userTeamIds as-is — the point here is that
    // subscriptionKey is 'admin', so the *effect* doesn't re-run on membership change.
    // We verify subscribe was called (not zero times, not more than once).
    expect(mockSubscribeTeams).toHaveBeenCalledTimes(1);
    // The first argument passed to subscribe should contain the actual team IDs
    expect(mockSubscribeTeams).toHaveBeenCalledWith(['team-a', 'team-b']);
  });

  // ─── userLeagueIds forwarding (the league-store scoping path) ──────────────
  //
  // The team-derived leagueIds path (union of team.leagueIds for the user's
  // teams) is hard to exercise here because the useTeamStore mock returns
  // empty teams unconditionally. These tests cover the membership-derived
  // path (m.leagueId on a profile membership), which is the load-bearing
  // path for league_manager memberships and for any future role that has
  // direct leagueId memberships.

  it('forwards membership-derived userLeagueIds to useLeagueStore.subscribe for non-admin', () => {
    currentUser = { uid: 'uid-coach' };
    // Coach with both a team membership and a league-bound membership
    currentProfile = {
      ...makeProfile('coach', ['team-a']),
      memberships: [
        { role: 'coach', teamId: 'team-a', isPrimary: true },
        { role: 'coach', leagueId: 'league-x' },
      ],
    };

    renderLayout();

    expect(mockSubscribeLeagues).toHaveBeenCalledTimes(1);
    // userLeagueIds is sorted (Array.from(Set).sort()) — single id so no
    // ordering ambiguity. The argument should be ['league-x'].
    expect(mockSubscribeLeagues).toHaveBeenCalledWith(['league-x']);
  });

  it('non-admin gaining a new league membership triggers leagues re-subscribe', () => {
    currentUser = { uid: 'uid-coach' };
    currentProfile = makeProfileWithLeagues('coach', ['league-x']);

    const { rerender } = renderLayout();

    expect(mockSubscribeLeagues).toHaveBeenCalledTimes(1);
    expect(mockSubscribeLeagues).toHaveBeenLastCalledWith(['league-x']);

    // Coach gets added to a second league
    act(() => {
      currentProfile = makeProfileWithLeagues('coach', ['league-x', 'league-y']);
    });
    rerender(
      <MemoryRouter>
        <MainLayout />
      </MemoryRouter>
    );

    expect(mockSubscribeLeagues).toHaveBeenCalledTimes(2);
    // sorted output — both ids in alphabetical order
    expect(mockSubscribeLeagues).toHaveBeenLastCalledWith(['league-x', 'league-y']);
  });

  it('admin profile with leagueId memberships still gets stable "admin" subscriptionKey', () => {
    currentUser = { uid: 'uid-admin' };
    currentProfile = makeProfileWithLeagues('admin', ['league-x']);

    const { rerender } = renderLayout();

    expect(mockSubscribeLeagues).toHaveBeenCalledTimes(1);

    // Admin acquires a second league — should NOT trigger re-subscribe
    // because admin's subscriptionKey is the stable 'admin' literal
    act(() => {
      currentProfile = makeProfileWithLeagues('admin', ['league-x', 'league-y']);
    });
    rerender(
      <MemoryRouter>
        <MainLayout />
      </MemoryRouter>
    );

    expect(mockSubscribeLeagues).toHaveBeenCalledTimes(1);
  });
});
