/**
 * Dashboard — RSVP subcollection migration (FW-97)
 *
 * Verifies that Dashboard.computeNextAction():
 *   A) Reads RSVP counts from useRsvpStore.rsvps (not event.rsvps)
 *   B) Calls loadForEvent for each upcoming event on mount (Approach A)
 *   C) low_rsvp alert fires correctly when rsvpStore data is used
 *
 * Note: Dashboard currently redirects all authenticated users immediately to
 * /home, so computeNextAction() is dead code at runtime. These tests exercise
 * the logic in isolation to prevent regressions if the redirect changes.
 *
 * Strategy: control storeRsvps via the useRsvpStore mock. Events with roster
 * players but 0 store RSVPs trigger the low_rsvp alert.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile, ScheduledEvent, Player, Team } from '@/types';
import type { RsvpEntry } from '@/store/useRsvpStore';

// ── Firebase stub ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

// ── navigate spy ──────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ── RSVP store mock ───────────────────────────────────────────────────────────

const mockLoadForEvent = vi.fn().mockResolvedValue(undefined);
let mockStoreRsvps: Record<string, RsvpEntry[]> = {};

vi.mock('@/store/useRsvpStore', () => {
  const storeSelector = (selector: (s: { rsvps: Record<string, RsvpEntry[]> }) => unknown) =>
    selector({ get rsvps() { return mockStoreRsvps; } });

  storeSelector.getState = () => ({
    loadForEvent: mockLoadForEvent,
    rsvps: mockStoreRsvps,
  });

  return { useRsvpStore: storeSelector };
});

// ── Auth store ────────────────────────────────────────────────────────────────

// Null profile keeps Dashboard from redirecting so we can test computeNextAction
let currentProfile: UserProfile | null = null;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { user: { uid: string } | null; profile: UserProfile | null }) => unknown) =>
    selector({ user: currentProfile ? { uid: currentProfile.uid } : null, profile: currentProfile }),
  getAccessibleTeamIds: (_profile: UserProfile | null, _teams: Team[]) => null,
  getMemberships: () => [],
  hasRole: (_profile: UserProfile | null, role: string) => currentProfile?.role === role,
  getActiveMembership: () => null,
}));

// ── Data stores ───────────────────────────────────────────────────────────────

let mockEvents: ScheduledEvent[] = [];
let mockPlayers: Player[] = [];

vi.mock('@/store/useEventStore', () => ({
  useEventStore: (selector?: (s: { events: ScheduledEvent[] }) => unknown) =>
    selector ? selector({ events: mockEvents }) : { events: mockEvents },
}));

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector?: (s: { teams: Team[] }) => unknown) =>
    selector ? selector({ teams: [] }) : { teams: [] },
}));

vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (selector?: (s: { players: Player[] }) => unknown) =>
    selector ? selector({ players: mockPlayers }) : { players: mockPlayers },
}));

vi.mock('@/store/useLeagueStore', () => ({
  useLeagueStore: (selector?: (s: { leagues: never[] }) => unknown) =>
    selector ? selector({ leagues: [] }) : { leagues: [] },
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

// ── Import after mocks ────────────────────────────────────────────────────────

import { Dashboard } from '@/pages/Dashboard';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FUTURE_DATE = '2099-12-31';
const FUTURE_TIME = '10:00';

function makeCoachProfile(): UserProfile {
  return {
    uid: 'uid-coach',
    email: 'coach@example.com',
    displayName: 'Coach',
    role: 'coach',
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

function makeUpcomingEvent(id: string, overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id,
    title: `Event ${id}`,
    type: 'game',
    status: 'scheduled',
    date: FUTURE_DATE,
    startTime: FUTURE_TIME,
    teamIds: ['t1'],
    isRecurring: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ScheduledEvent;
}

function makePlayer(id: string): Player {
  return {
    id,
    teamId: 't1',
    firstName: 'Player',
    lastName: id,
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as Player;
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
  mockEvents = [];
  mockPlayers = [];
  mockStoreRsvps = {};
});

// ── A. RSVP count from store, not event.rsvps ─────────────────────────────────

describe('Dashboard — computeNextAction reads from useRsvpStore (FW-97)', () => {
  it('shows low_rsvp alert when store has 0 RSVPs for an upcoming event with roster players', async () => {
    // Profile null so Dashboard does not redirect; coach profile for computeNextAction
    // We set profile after initial render to let the redirect effect fire but with null
    // Actually: set a coach profile with no redirect by mocking navigate to no-op
    currentProfile = makeCoachProfile();
    mockNavigate.mockImplementation(() => {}); // suppress redirect
    mockEvents = [makeUpcomingEvent('event-low-rsvp')];
    mockPlayers = [makePlayer('p1'), makePlayer('p2'), makePlayer('p3'), makePlayer('p4')];
    // 0 RSVPs in store → 0/4 = 0 < 0.5 → low_rsvp
    mockStoreRsvps = {};

    renderDashboard();

    // Dashboard shows "haven't responded" copy for low_rsvp
    await waitFor(() => {
      expect(screen.getByText(/haven't responded/i)).toBeInTheDocument();
    });
  });

  it('does NOT fire low_rsvp alert when store shows enough responses', async () => {
    currentProfile = makeCoachProfile();
    mockNavigate.mockImplementation(() => {});
    mockEvents = [makeUpcomingEvent('event-ok')];
    mockPlayers = [makePlayer('p1'), makePlayer('p2')];
    // 2/2 = 100% responded → no low_rsvp
    mockStoreRsvps = {
      'event-ok': [
        { uid: 'uid-a', playerId: 'p1', name: 'P1', response: 'yes', updatedAt: '2026-01-01' },
        { uid: 'uid-b', playerId: 'p2', name: 'P2', response: 'yes', updatedAt: '2026-01-01' },
      ],
    };

    renderDashboard();

    await waitFor(() => {
      expect(screen.queryByText(/haven't responded/i)).not.toBeInTheDocument();
    });
  });
});

// ── B. loadForEvent called for each upcoming event ────────────────────────────

describe('Dashboard — calls loadForEvent for upcoming events on mount (FW-97)', () => {
  it('calls loadForEvent for each upcoming event', async () => {
    currentProfile = null; // No redirect while testing this
    mockEvents = [
      makeUpcomingEvent('event-a'),
      makeUpcomingEvent('event-b'),
    ];

    renderDashboard();

    await waitFor(() => {
      expect(mockLoadForEvent).toHaveBeenCalledWith('event-a');
      expect(mockLoadForEvent).toHaveBeenCalledWith('event-b');
    });
  });

  it('does not call loadForEvent for cancelled events', async () => {
    currentProfile = null;
    mockEvents = [
      makeUpcomingEvent('event-active'),
      makeUpcomingEvent('event-cancelled', { status: 'cancelled' }),
    ];

    renderDashboard();

    await waitFor(() => {
      expect(mockLoadForEvent).toHaveBeenCalledWith('event-active');
    });

    expect(mockLoadForEvent).not.toHaveBeenCalledWith('event-cancelled');
  });
});
