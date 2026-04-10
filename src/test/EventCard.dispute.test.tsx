/**
 * EventCard — dispute badge (PR #125)
 *
 * Tests that the red "Dispute" badge appears when and only when
 * event.disputeStatus === 'open'.
 *
 * EventCard uses granular selectors: useAuthStore(s => s.user), useAuthStore(s => s.profile)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ScheduledEvent, Team } from '@/types';

// ── Firebase mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {} }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
}));

// ── Store mocks ───────────────────────────────────────────────────────────────

// EventCard uses granular selectors — mock must apply the selector to the state object.
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (s: (state: { user: null; profile: null }) => unknown) =>
    s({ user: null, profile: null }),
  getActiveMembership: vi.fn(() => null),
}));

vi.mock('@/store/useEventStore', () => ({
  useEventStore: (selector: (s: { updateEvent: () => void }) => unknown) =>
    selector({ updateEvent: vi.fn() }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTeam(id: string): Team {
  return {
    id,
    name: `Team ${id}`,
    sportType: 'soccer',
    color: '#000000',
    homeVenue: '',
    coachName: '',
    coachEmail: '',
    coachPhone: '',
    ageGroup: 'U12',
    createdBy: 'user1',
    isDeleted: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as Team;
}

function makeEvent(overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id: 'event-1',
    title: 'Team t1 vs Team t2',
    type: 'game',
    status: 'completed',
    date: '2026-03-20',
    startTime: '10:00',
    teamIds: ['t1', 't2'],
    homeTeamId: 't1',
    awayTeamId: 't2',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ScheduledEvent;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNamedTeam(id: string, name: string, color = '#ff0000'): Team {
  return {
    id,
    name,
    sportType: 'soccer',
    color,
    homeVenue: '',
    coachName: '',
    coachEmail: '',
    coachPhone: '',
    ageGroup: 'U12',
    createdBy: 'user1',
    isDeleted: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as Team;
}

function makeGameEvent(overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id: 'event-game',
    title: 'Game',
    type: 'game',
    status: 'scheduled',
    date: '2026-05-01',
    startTime: '10:00',
    teamIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ScheduledEvent;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EventCard — opponent display (fix/eventcard-away-opponent-display)', () => {
  let EventCard: typeof import('@/components/events/EventCard').EventCard;

  beforeEach(async () => {
    ({ EventCard } = await import('@/components/events/EventCard'));
  });

  it('shows home team left and away team right when both teams resolve from the teams array', () => {
    const sharks = makeNamedTeam('home-1', 'Sharks');
    const eagles = makeNamedTeam('away-1', 'Eagles');
    render(
      <EventCard
        event={makeGameEvent({ homeTeamId: 'home-1', awayTeamId: 'away-1' })}
        teams={[sharks, eagles]}
      />
    );
    expect(screen.getByText('Sharks')).toBeInTheDocument();
    expect(screen.getByText('Eagles')).toBeInTheDocument();
    expect(screen.getByText('vs')).toBeInTheDocument();
  });

  it('shows opponentName on the right when our team is home and opponent is external', () => {
    const sharks = makeNamedTeam('home-1', 'Sharks');
    render(
      <EventCard
        event={makeGameEvent({ homeTeamId: 'home-1', opponentName: 'River FC' })}
        teams={[sharks]}
      />
    );
    expect(screen.getByText('Sharks')).toBeInTheDocument();
    expect(screen.getByText('River FC')).toBeInTheDocument();
    expect(screen.getByText('vs')).toBeInTheDocument();
  });

  it('shows opponentName on the LEFT and our away team on the right when our team is away', () => {
    // This is the bug scenario: before the fix, opponentName was dropped entirely.
    const sharks = makeNamedTeam('away-1', 'Sharks');
    render(
      <EventCard
        event={makeGameEvent({ awayTeamId: 'away-1', opponentName: 'River FC' })}
        teams={[sharks]}
      />
    );
    const items = screen.getAllByText(/Sharks|River FC/);
    expect(items).toHaveLength(2);
    expect(screen.getByText('River FC')).toBeInTheDocument();
    expect(screen.getByText('Sharks')).toBeInTheDocument();
    expect(screen.getByText('vs')).toBeInTheDocument();
    // River FC (home/left) must appear before Sharks (away/right) in the DOM
    const allText = document.body.textContent ?? '';
    expect(allText.indexOf('River FC')).toBeLessThan(allText.indexOf('Sharks'));
  });

  it('does not render vs or opponent section when neither teams nor opponentName are present', () => {
    render(
      <EventCard
        event={makeGameEvent({ homeTeamId: undefined, awayTeamId: undefined, opponentName: undefined })}
        teams={[]}
      />
    );
    expect(screen.queryByText('vs')).not.toBeInTheDocument();
  });

  it('does not render vs separator when only opponentName is set with no teams at all', () => {
    // opponentName alone with no matching teams — renders right side only, no separator needed
    render(
      <EventCard
        event={makeGameEvent({ opponentName: 'Lone FC' })}
        teams={[]}
      />
    );
    expect(screen.getByText('Lone FC')).toBeInTheDocument();
    expect(screen.queryByText('vs')).not.toBeInTheDocument();
  });
});

describe('EventCard — dispute badge', () => {
  let EventCard: typeof import('@/components/events/EventCard').EventCard;

  beforeEach(async () => {
    ({ EventCard } = await import('@/components/events/EventCard'));
  });

  it('renders a Dispute badge when disputeStatus is "open"', () => {
    render(
      <EventCard
        event={makeEvent({ disputeStatus: 'open' })}
        teams={[makeTeam('t1'), makeTeam('t2')]}
      />
    );
    expect(screen.getByText('Dispute')).toBeInTheDocument();
  });

  it('does not render a Dispute badge when disputeStatus is absent', () => {
    render(
      <EventCard
        event={makeEvent()}
        teams={[makeTeam('t1'), makeTeam('t2')]}
      />
    );
    expect(screen.queryByText('Dispute')).not.toBeInTheDocument();
  });

  it('does not render a Dispute badge when disputeStatus is undefined', () => {
    render(
      <EventCard
        event={makeEvent({ disputeStatus: undefined })}
        teams={[makeTeam('t1'), makeTeam('t2')]}
      />
    );
    expect(screen.queryByText('Dispute')).not.toBeInTheDocument();
  });
});
