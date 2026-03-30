/**
 * EventCard — dispute badge (PR #125)
 *
 * Tests that the red "Dispute" badge appears when and only when
 * event.disputeStatus === 'open'.
 *
 * EventCard calls useAuthStore() WITHOUT a selector (destructures result),
 * so the mock returns the state object directly.
 */

import React from 'react';
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

// EventCard calls useAuthStore() with NO selector — must return object directly.
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({ user: null, profile: null }),
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

// ── Tests ─────────────────────────────────────────────────────────────────────

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
