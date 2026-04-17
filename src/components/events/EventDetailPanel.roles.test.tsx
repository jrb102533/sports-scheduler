/**
 * EventDetailPanel — Role-gated UI visibility tests
 *
 * Sections under test:
 *   A) RSVP section — visible only when event is not cancelled/completed AND authUser is non-null
 *      (No role restriction on RSVP; any authenticated user sees it.)
 *   B) Action footer (Edit/Duplicate/Cancel/Delete buttons) — hidden for isReadOnly roles
 *      (player and parent are isReadOnly; admin/coach/league_manager are not)
 *   C) "Cancel Event" button within the footer — hidden when event.status === 'cancelled'
 *   D) Attendance Forecast section — only visible to canManage roles
 *      (admin, coach, league_manager) — hidden for parent and player
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ScheduledEvent, Team, UserProfile } from '@/types';

// ── Firebase mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  doc: vi.fn(),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  deleteField: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  getDoc: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(() => vi.fn()),
}));

// ── Mutable auth state ─────────────────────────────────────────────────────────

let currentProfile: UserProfile | null = null;
let currentUser: { uid: string } | null = null;

// ── Store mocks ────────────────────────────────────────────────────────────────

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: { user: typeof currentUser; profile: typeof currentProfile }) => unknown) =>
    selector({ user: currentUser, profile: currentProfile }),
  getMemberships: (profile: UserProfile | null) => {
    if (!profile) return [];
    if (profile.memberships && profile.memberships.length > 0) return profile.memberships;
    return [{ role: profile.role, isPrimary: true, teamId: profile.teamId }];
  },
  getActiveMembership: vi.fn(() => null),
  hasRole: vi.fn((profile: UserProfile | null, ...roles: string[]) => {
    if (!profile) return false;
    return roles.includes(profile.role);
  }),
}));

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: (selector: (s: { teams: Team[] }) => unknown) =>
    selector({ teams: [] }),
}));

vi.mock('@/store/useEventStore', () => ({
  useEventStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      updateEvent: vi.fn(),
      events: [],
      deleteEvent: vi.fn(),
      recordResult: vi.fn(),
      deleteEventsByGroupId: vi.fn(),
    }),
}));

vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (selector: (s: { players: never[] }) => unknown) =>
    selector({ players: [] }),
}));

vi.mock('@/store/useVenueStore', () => {
  const subscribe = vi.fn(() => () => {});
  const useVenueStore = (selector: (s: { venues: never[]; subscribe: typeof subscribe }) => unknown) =>
    selector({ venues: [], subscribe });
  useVenueStore.getState = () => ({ venues: [], subscribe });
  return { useVenueStore };
});

vi.mock('@/store/useLeagueVenueStore', () => {
  const subscribe = vi.fn(() => () => {});
  const useLeagueVenueStore = (selector: (s: { venues: never[]; subscribe: typeof subscribe }) => unknown) =>
    selector({ venues: [], subscribe });
  useLeagueVenueStore.getState = () => ({ venues: [], subscribe });
  return { useLeagueVenueStore };
});

// ── Sub-component stubs ────────────────────────────────────────────────────────

vi.mock('@/components/attendance/AttendanceTracker', () => ({
  AttendanceTracker: () => null,
}));
vi.mock('@/components/events/SnackVolunteerForm', () => ({
  SnackVolunteerForm: () => null,
}));
vi.mock('@/components/events/RsvpInviteModal', () => ({
  RsvpInviteModal: () => null,
}));
vi.mock('@/components/events/PostGameBroadcastModal', () => ({
  PostGameBroadcastModal: () => null,
}));
vi.mock('@/components/events/EventForm', () => ({
  EventForm: () => null,
}));
vi.mock('@/components/events/RsvpButton', () => ({
  RsvpButton: () => <div data-testid="rsvp-button">RSVP Button</div>,
}));
vi.mock('@/components/roster/PlayerStatusBadge', () => ({
  PlayerStatusBadge: () => null,
}));

// ── Import after mocks ─────────────────────────────────────────────────────────

import { EventDetailPanel } from './EventDetailPanel';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id: 'event-1',
    title: 'Practice Session',
    type: 'practice',
    status: 'scheduled',
    date: '2026-06-01',
    startTime: '10:00',
    teamIds: ['t1'],
    isRecurring: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ScheduledEvent;
}

function makeProfile(role: UserProfile['role'], uid = 'user-1'): UserProfile {
  return {
    uid,
    email: `${role}@example.com`,
    displayName: `${role} User`,
    role,
    teamId: 't1',
    createdAt: '2024-01-01T00:00:00.000Z',
  } as UserProfile;
}

function renderPanel(event: ScheduledEvent, profile: UserProfile | null, userId?: string) {
  currentProfile = profile;
  currentUser = userId ? { uid: userId } : null;
  return render(<EventDetailPanel event={event} onClose={() => {}} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  currentProfile = null;
  currentUser = null;
});

// ── A. RSVP section visibility ─────────────────────────────────────────────────

describe('EventDetailPanel — RSVP section', () => {
  it('shows RSVP section for an authenticated user on a scheduled event', () => {
    renderPanel(makeEvent({ status: 'scheduled' }), makeProfile('parent'), 'user-1');
    expect(screen.getByText('RSVP')).toBeInTheDocument();
  });

  it('shows RSVP section for an authenticated coach on a scheduled event', () => {
    renderPanel(makeEvent({ status: 'scheduled' }), makeProfile('coach'), 'coach-1');
    expect(screen.getByText('RSVP')).toBeInTheDocument();
  });

  it('hides RSVP section when event is cancelled', () => {
    renderPanel(makeEvent({ status: 'cancelled' }), makeProfile('parent'), 'user-1');
    expect(screen.queryByText('RSVP')).not.toBeInTheDocument();
  });

  it('hides RSVP section when event is completed', () => {
    renderPanel(makeEvent({ status: 'completed' }), makeProfile('parent'), 'user-1');
    expect(screen.queryByText('RSVP')).not.toBeInTheDocument();
  });

  it('hides RSVP section when user is not authenticated (no authUser)', () => {
    renderPanel(makeEvent({ status: 'scheduled' }), makeProfile('parent'), undefined);
    expect(screen.queryByText('RSVP')).not.toBeInTheDocument();
  });
});

// ── B. Action footer — isReadOnly roles see no footer ─────────────────────────

describe('EventDetailPanel — action footer visibility', () => {
  it('shows Edit and Delete buttons for admin', () => {
    renderPanel(makeEvent(), makeProfile('admin'), 'admin-1');
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('shows Edit and Delete buttons for coach', () => {
    renderPanel(makeEvent(), makeProfile('coach'), 'coach-1');
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('shows Edit and Delete buttons for league_manager', () => {
    renderPanel(makeEvent(), makeProfile('league_manager'), 'lm-1');
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('hides all action buttons for player (isReadOnly)', () => {
    renderPanel(makeEvent(), makeProfile('player'), 'player-1');
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('hides all action buttons for parent (isReadOnly)', () => {
    renderPanel(makeEvent(), makeProfile('parent'), 'parent-1');
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});

// ── C. Cancel Event button ─────────────────────────────────────────────────────

describe('EventDetailPanel — Cancel Event button', () => {
  it('shows Cancel Event button for coach when event is scheduled', () => {
    renderPanel(makeEvent({ status: 'scheduled' }), makeProfile('coach'), 'coach-1');
    expect(screen.getByRole('button', { name: /cancel event/i })).toBeInTheDocument();
  });

  it('hides Cancel Event button when event is already cancelled', () => {
    renderPanel(makeEvent({ status: 'cancelled' }), makeProfile('coach'), 'coach-1');
    expect(screen.queryByRole('button', { name: /cancel event/i })).not.toBeInTheDocument();
  });

  it('hides Cancel Event button for player (isReadOnly, whole footer hidden)', () => {
    renderPanel(makeEvent({ status: 'scheduled' }), makeProfile('player'), 'player-1');
    expect(screen.queryByRole('button', { name: /cancel event/i })).not.toBeInTheDocument();
  });
});

// ── D. Attendance Forecast section ────────────────────────────────────────────

describe('EventDetailPanel — Attendance Forecast section', () => {
  // Attendance Forecast only shows when respondedCount > 0 OR rosterSize > 0.
  // We test with rsvps populated so the guard passes.

  function makeEventWithRsvps(): ScheduledEvent {
    return makeEvent({
      rsvps: [
        { playerId: 'p1', name: 'Alice', response: 'yes' as const, createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
  }

  it('shows Attendance Forecast for admin', () => {
    renderPanel(makeEventWithRsvps(), makeProfile('admin'), 'admin-1');
    expect(screen.getByText('Attendance Forecast')).toBeInTheDocument();
  });

  it('shows Attendance Forecast for coach', () => {
    renderPanel(makeEventWithRsvps(), makeProfile('coach'), 'coach-1');
    expect(screen.getByText('Attendance Forecast')).toBeInTheDocument();
  });

  it('shows Attendance Forecast for league_manager', () => {
    renderPanel(makeEventWithRsvps(), makeProfile('league_manager'), 'lm-1');
    expect(screen.getByText('Attendance Forecast')).toBeInTheDocument();
  });

  it('does NOT show Attendance Forecast for player', () => {
    renderPanel(makeEventWithRsvps(), makeProfile('player'), 'player-1');
    expect(screen.queryByText('Attendance Forecast')).not.toBeInTheDocument();
  });

  it('does NOT show Attendance Forecast for parent', () => {
    renderPanel(makeEventWithRsvps(), makeProfile('parent'), 'parent-1');
    expect(screen.queryByText('Attendance Forecast')).not.toBeInTheDocument();
  });
});

// ── E. Null event guard ───────────────────────────────────────────────────────

describe('EventDetailPanel — null event', () => {
  it('renders nothing when event is null', () => {
    currentProfile = makeProfile('admin');
    currentUser = { uid: 'admin-1' };
    const { container } = render(<EventDetailPanel event={null} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
