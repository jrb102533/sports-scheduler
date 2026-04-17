/**
 * EventCard — general rendering tests
 *
 * Complements EventCard.dispute.test.tsx which covers the dispute badge.
 *
 * Behaviours under test:
 *   A) Core fields render: title, type badge, status badge, date+time, location
 *   B) Team matchup section: home vs away, opponent name fallback
 *   C) Result display: score format and placement format
 *   D) onClick fires when card is clicked
 *   E) Completed/cancelled events do not show interactive RSVP elements
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScheduledEvent, Team, UserProfile } from '@/types';

// ── Firebase mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {} }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
}));

// ── Mutable auth state ─────────────────────────────────────────────────────────

let currentUser: { uid: string } | null = null;
let currentProfile: UserProfile | null = null;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (s: (state: { user: typeof currentUser; profile: typeof currentProfile }) => unknown) =>
    s({ user: currentUser, profile: currentProfile }),
  getActiveMembership: vi.fn(() => null),
}));

vi.mock('@/store/useEventStore', () => ({
  useEventStore: (selector: (s: { updateEvent: () => void }) => unknown) =>
    selector({ updateEvent: vi.fn() }),
}));

// ── Import after mocks ─────────────────────────────────────────────────────────

import { EventCard } from './EventCard';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeTeam(id: string, name: string, color = '#ef4444'): Team {
  return {
    id, name, color,
    sportType: 'soccer',
    createdBy: 'uid-1',
    attendanceWarningsEnabled: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as Team;
}

function makeEvent(overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id: 'event-1',
    title: 'Championship Game',
    type: 'game',
    status: 'scheduled',
    date: '2026-06-15',
    startTime: '10:00',
    teamIds: ['team-a'],
    isRecurring: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ScheduledEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = null;
  currentProfile = null;
});

// ── A. Core fields ─────────────────────────────────────────────────────────────

describe('EventCard — core field rendering', () => {
  it('renders the event title', () => {
    render(<EventCard event={makeEvent({ title: 'Tournament Final' })} teams={[]} />);
    expect(screen.getByText('Tournament Final')).toBeInTheDocument();
  });

  it('renders the event type badge', () => {
    render(<EventCard event={makeEvent({ type: 'practice' })} teams={[]} />);
    expect(screen.getByText('Practice')).toBeInTheDocument();
  });

  it('renders the event status badge', () => {
    render(<EventCard event={makeEvent({ status: 'cancelled' })} teams={[]} />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('renders the formatted date and time', () => {
    render(<EventCard event={makeEvent({ date: '2026-06-15', startTime: '14:30' })} teams={[]} />);
    expect(screen.getByText(/jun 15, 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/2:30 pm/i)).toBeInTheDocument();
  });

  it('renders the location when set', () => {
    render(<EventCard event={makeEvent({ location: 'City Park Field 1' })} teams={[]} />);
    expect(screen.getByText('City Park Field 1')).toBeInTheDocument();
  });

  it('does not show location when not set', () => {
    render(<EventCard event={makeEvent({ location: undefined })} teams={[]} />);
    expect(screen.queryByText(/field/i)).not.toBeInTheDocument();
  });
});

// ── B. Team matchup section ────────────────────────────────────────────────────

describe('EventCard — team matchup rendering', () => {
  const HOME = makeTeam('t1', 'Hawks');
  const AWAY = makeTeam('t2', 'Eagles');

  it('shows home team name and away team name with "vs" separator', () => {
    const event = makeEvent({ homeTeamId: 't1', awayTeamId: 't2', teamIds: ['t1', 't2'] });
    render(<EventCard event={event} teams={[HOME, AWAY]} />);
    expect(screen.getByText('Hawks')).toBeInTheDocument();
    expect(screen.getByText('Eagles')).toBeInTheDocument();
    expect(screen.getByText('vs')).toBeInTheDocument();
  });

  it('shows opponent name when opponentName is set and no away team object', () => {
    const event = makeEvent({ homeTeamId: 't1', opponentName: 'River FC', teamIds: ['t1'] });
    render(<EventCard event={event} teams={[HOME]} />);
    expect(screen.getByText('Hawks')).toBeInTheDocument();
    expect(screen.getByText('River FC')).toBeInTheDocument();
  });

  it('does not show matchup section when no teams or opponentName', () => {
    const event = makeEvent({ homeTeamId: undefined, awayTeamId: undefined, opponentName: undefined });
    render(<EventCard event={event} teams={[]} />);
    expect(screen.queryByText('vs')).not.toBeInTheDocument();
  });
});

// ── C. Result display ─────────────────────────────────────────────────────────

describe('EventCard — result display', () => {
  it('shows the score in "X – Y" format when result is set', () => {
    const event = makeEvent({
      status: 'completed',
      result: { homeScore: 3, awayScore: 1 },
    });
    render(<EventCard event={event} teams={[]} />);
    expect(screen.getByText(/3.*1/)).toBeInTheDocument();
  });

  it('shows the placement text when result has placement', () => {
    const event = makeEvent({
      type: 'tournament',
      status: 'completed',
      result: { homeScore: 0, awayScore: 0, placement: '1st Place' },
    });
    render(<EventCard event={event} teams={[]} />);
    expect(screen.getByText('1st Place')).toBeInTheDocument();
  });

  it('does not show result section when event has no result', () => {
    const event = makeEvent({ result: undefined });
    render(<EventCard event={event} teams={[]} />);
    // No score-like numbers rendered outside the date
    expect(screen.queryByText(/0 – 0/)).not.toBeInTheDocument();
  });
});

// ── D. onClick ─────────────────────────────────────────────────────────────────

describe('EventCard — onClick', () => {
  it('calls onClick when the card is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<EventCard event={makeEvent()} teams={[]} onClick={onClick} />);
    await user.click(screen.getByText('Championship Game'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not throw when no onClick is provided', async () => {
    const user = userEvent.setup();
    render(<EventCard event={makeEvent()} teams={[]} />);
    await expect(user.click(screen.getByText('Championship Game'))).resolves.toBeUndefined();
  });
});

// ── E. RSVP section not shown for completed/cancelled events ───────────────────

describe('EventCard — RSVP interactive section', () => {
  beforeEach(() => {
    // Authenticated user
    currentUser = { uid: 'uid-alice' };
    currentProfile = {
      uid: 'uid-alice',
      email: 'alice@example.com',
      displayName: 'Alice',
      role: 'player',
      teamId: 't1',
      createdAt: '2024-01-01T00:00:00.000Z',
    } as UserProfile;
  });

  it('does not show RSVP button for a completed event', () => {
    const event = makeEvent({ status: 'completed' });
    render(<EventCard event={event} teams={[]} />);
    // The RSVP indicator returns null for completed events
    expect(screen.queryByRole('button', { name: /rsvp/i })).not.toBeInTheDocument();
  });

  it('does not show RSVP button for a cancelled event', () => {
    const event = makeEvent({ status: 'cancelled' });
    render(<EventCard event={event} teams={[]} />);
    expect(screen.queryByRole('button', { name: /rsvp/i })).not.toBeInTheDocument();
  });
});
