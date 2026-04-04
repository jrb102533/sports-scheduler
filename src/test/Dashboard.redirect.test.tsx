/**
 * Dashboard — player/parent redirect via useEffect
 *
 * Change under test: the render-time <Navigate> was replaced with a
 * useEffect that calls navigate('/parent', { replace: true }) when the
 * loaded profile has role 'player' or 'parent'.
 *
 * Risk: the old code ran synchronously during render (easy to reason about);
 * the new code runs after render in an effect, which means there is a brief
 * window where the Dashboard body renders for a player/parent before the
 * redirect fires. These tests verify that:
 *   1. navigate IS called (redirect still happens).
 *   2. navigate is called with replace:true (no history entry left behind).
 *   3. non-redirected roles do NOT trigger navigate.
 *   4. navigate does not fire while profile is still null (loading state).
 *
 * Strategy: mount Dashboard inside MemoryRouter. All stores are mocked;
 * useNavigate is replaced with a vi.fn() spy via vi.mock so we can assert
 * on the call without a full router setup.
 *
 * Note: Dashboard renders many child components (EventCard, EventDetailPanel,
 * etc.) that each have their own store subscriptions. All stores are mocked
 * with empty state to keep the test surface minimal.
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

// Some child components call useAuthStore(s => s.user), others call
// useAuthStore(s => s.profile). The stub state provides both.
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { user: { uid: string } | null; profile: UserProfile | null }) => unknown) =>
    selector({ user: currentProfile ? { uid: currentProfile.uid } : null, profile: currentProfile }),
  getAccessibleTeamIds: () => null,
  getMemberships: () => [],
  hasRole: () => false,
}));

// ─── Data stores — all empty ──────────────────────────────────────────────────
// Some child components (EventForm) call useEventStore() without a selector
// (destructuring pattern). The mock must handle both:
//   useEventStore()          → returns state object directly
//   useEventStore(s => s.x) → calls selector with state object

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

const EMPTY_VENUE_STATE = { venues: [], subscribe: vi.fn() };
const useVenueStoreMock = (selector?: (s: typeof EMPTY_VENUE_STATE) => unknown) =>
  selector ? selector(EMPTY_VENUE_STATE) : EMPTY_VENUE_STATE;
useVenueStoreMock.getState = () => EMPTY_VENUE_STATE;

vi.mock('@/store/useVenueStore', () => ({ useVenueStore: useVenueStoreMock }));

// EventDetailPanel pulls in useRsvpStore/useSnackStore which reach firebase — stub it out
// since Dashboard.redirect tests are only concerned with routing behaviour.
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

describe('Dashboard — player/parent redirect', () => {

  it('redirects a player to /parent', async () => {
    currentProfile = makeProfile('player');
    renderDashboard();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/parent', { replace: true });
    });
  });

  it('redirects a parent to /parent', async () => {
    currentProfile = makeProfile('parent');
    renderDashboard();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/parent', { replace: true });
    });
  });

  it('uses replace:true so no history entry is left for the Dashboard', async () => {
    currentProfile = makeProfile('player');
    renderDashboard();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());

    const [, options] = mockNavigate.mock.calls[0] as [string, { replace: boolean }];
    expect(options.replace).toBe(true);
  });

  it('does NOT redirect an admin', async () => {
    currentProfile = makeProfile('admin');
    renderDashboard();

    // Wait one tick to give any stray effect a chance to fire
    await waitFor(() => {}, { timeout: 100 });

    expect(mockNavigate).not.toHaveBeenCalledWith('/parent', expect.anything());
  });

  it('does NOT redirect a coach', async () => {
    currentProfile = makeProfile('coach');
    renderDashboard();

    await waitFor(() => {}, { timeout: 100 });

    expect(mockNavigate).not.toHaveBeenCalledWith('/parent', expect.anything());
  });

  it('does NOT redirect a league_manager', async () => {
    currentProfile = makeProfile('league_manager');
    renderDashboard();

    await waitFor(() => {}, { timeout: 100 });

    expect(mockNavigate).not.toHaveBeenCalledWith('/parent', expect.anything());
  });

  it('does NOT redirect while profile is null (still loading)', async () => {
    currentProfile = null;
    renderDashboard();

    await waitFor(() => {}, { timeout: 100 });

    expect(mockNavigate).not.toHaveBeenCalledWith('/parent', expect.anything());
  });

});
