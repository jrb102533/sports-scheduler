/**
 * Dashboard — universal redirect to /home via useEffect
 *
 * Change under test (navigation + unified home PR): ALL authenticated roles
 * are now redirected to /home instead of role-specific destinations.
 * Previously only player/parent were redirected to /parent; now the effect
 * fires for every non-null profile, directing everyone to /home.
 *
 * These tests verify:
 *   1. Every role (player, parent, coach, admin, league_manager) redirects to /home.
 *   2. The redirect uses replace:true so no Dashboard history entry is left behind.
 *   3. navigate is NOT called while profile is null (loading state).
 *
 * Strategy: mount Dashboard inside MemoryRouter. All stores are mocked;
 * useNavigate is replaced with a vi.fn() spy via vi.mock so we can assert
 * on the call without a full router setup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile } from '@/types';

// ─── Firebase stub — prevents auth/invalid-api-key at module init ─────────────
vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

// ─── navigate spy ─────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ─── Auth store ───────────────────────────────────────────────────────────────

let currentProfile: UserProfile | null = null;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { user: { uid: string } | null; profile: UserProfile | null }) => unknown) =>
    selector({ user: currentProfile ? { uid: currentProfile.uid } : null, profile: currentProfile }),
  getAccessibleTeamIds: () => null,
  getMemberships: () => [],
  hasRole: () => false,
}));

// ─── Data stores — all empty ──────────────────────────────────────────────────

const EMPTY_EVENT_STATE = {
  events: [],
  addEvent: vi.fn(),
  bulkAddEvents: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  recordResult: vi.fn(),
  deleteEventsByGroupId: vi.fn(),
};

vi.mock('@/store/useEventStore', () => ({
  useEventStore: (selector?: (s: typeof EMPTY_EVENT_STATE) => unknown) =>
    selector ? selector(EMPTY_EVENT_STATE) : EMPTY_EVENT_STATE,
}));

const EMPTY_TEAM_STATE = { teams: [] };

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector?: (s: typeof EMPTY_TEAM_STATE) => unknown) =>
    selector ? selector(EMPTY_TEAM_STATE) : EMPTY_TEAM_STATE,
}));

const EMPTY_PLAYER_STATE = { players: [] };

vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (selector?: (s: typeof EMPTY_PLAYER_STATE) => unknown) =>
    selector ? selector(EMPTY_PLAYER_STATE) : EMPTY_PLAYER_STATE,
}));

const EMPTY_LEAGUE_STATE = { leagues: [] };

vi.mock('@/store/useLeagueStore', () => ({
  useLeagueStore: (selector?: (s: typeof EMPTY_LEAGUE_STATE) => unknown) =>
    selector ? selector(EMPTY_LEAGUE_STATE) : EMPTY_LEAGUE_STATE,
}));

vi.mock('@/store/useNotificationStore', () => ({
  useNotificationStore: (selector: (s: { notifications: never[] }) => unknown) =>
    selector({ notifications: [] }),
}));

const useVenueStoreMock = vi.hoisted(() => {
  const subscribe = vi.fn().mockReturnValue(() => {});
  const state = { venues: [] as never[], subscribe };
  const mock = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  mock.getState = () => state;
  return mock;
});

vi.mock('@/store/useVenueStore', () => ({ useVenueStore: useVenueStoreMock }));

vi.mock('@/components/events/EventDetailPanel', () => ({
  EventDetailPanel: () => null,
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { Dashboard } from '@/pages/Dashboard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(role: UserProfile['role']): UserProfile {
  return {
    uid: 'uid-1',
    email: 'user@example.com',
    displayName: 'Test User',
    role,
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
});

describe('Dashboard — universal /home redirect', () => {

  it('redirects a player to /home', async () => {
    currentProfile = makeProfile('player');
    renderDashboard();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/home', { replace: true });
    });
  });

  it('redirects a parent to /home', async () => {
    currentProfile = makeProfile('parent');
    renderDashboard();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/home', { replace: true });
    });
  });

  it('redirects a coach to /home', async () => {
    currentProfile = makeProfile('coach');
    renderDashboard();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/home', { replace: true });
    });
  });

  it('redirects an admin to /home', async () => {
    currentProfile = makeProfile('admin');
    renderDashboard();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/home', { replace: true });
    });
  });

  it('redirects a league_manager to /home', async () => {
    currentProfile = makeProfile('league_manager');
    renderDashboard();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/home', { replace: true });
    });
  });

  it('uses replace:true so no history entry is left for the Dashboard', async () => {
    currentProfile = makeProfile('coach');
    renderDashboard();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());

    const [destination, options] = mockNavigate.mock.calls[0] as [string, { replace: boolean }];
    expect(destination).toBe('/home');
    expect(options.replace).toBe(true);
  });

  it('does NOT redirect while profile is null (still loading)', async () => {
    currentProfile = null;
    renderDashboard();

    await waitFor(() => {}, { timeout: 100 });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

});
