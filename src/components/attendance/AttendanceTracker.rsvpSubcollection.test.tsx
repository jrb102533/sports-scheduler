/**
 * AttendanceTracker — RSVP subcollection (FW-97 / FW-95)
 *
 * Verifies that AttendanceTracker:
 *   A) Calls loadForEvent on mount to fetch subcollection RSVPs
 *   B) Pre-fills attendance from store RSVPs (sole source of truth; FW-95 dropped event.rsvps)
 *   C) "Pre-fill from RSVPs" button is absent when store has no RSVPs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScheduledEvent, Player } from '@/types';
import type { RsvpEntry } from '@/store/useRsvpStore';

// ── Firebase stub ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, app: {}, functions: {} }));

// ── RSVP store mock ───────────────────────────────────────────────────────────

const mockLoadForEvent = vi.fn().mockResolvedValue(undefined);
let mockStoreRsvps: Record<string, RsvpEntry[]> = {};

vi.mock('@/store/useRsvpStore', () => {
  const storeSelector = (selector: (s: { rsvps: Record<string, RsvpEntry[]> }) => unknown) =>
    selector({ get rsvps() { return mockStoreRsvps; } });

  // Expose getState so the useEffect can call loadForEvent via getState()
  storeSelector.getState = () => ({
    loadForEvent: mockLoadForEvent,
    rsvps: mockStoreRsvps,
  });

  return { useRsvpStore: storeSelector };
});

// ── Event store mock ──────────────────────────────────────────────────────────

const mockUpdateEvent = vi.fn();

vi.mock('@/store/useEventStore', () => ({
  useEventStore: () => ({ updateEvent: mockUpdateEvent }),
}));

// ── Player store mock ─────────────────────────────────────────────────────────

let mockPlayers: Player[] = [];

vi.mock('@/store/usePlayerStore', () => ({
  usePlayerStore: (selector: (s: { players: Player[] }) => unknown) =>
    selector({ players: mockPlayers }),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { AttendanceTracker } from './AttendanceTracker';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id: 'event-1',
    title: 'Practice',
    type: 'practice',
    status: 'scheduled',
    date: '2026-07-01',
    startTime: '09:00',
    teamIds: ['t1'],
    isRecurring: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ScheduledEvent;
}

function makePlayer(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    teamId: 't1',
    firstName: 'Player',
    lastName: id,
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as Player;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreRsvps = {};
  mockPlayers = [makePlayer('p1')];
});

// ── A. loadForEvent called on mount ──────────────────────────────────────────

describe('AttendanceTracker — calls loadForEvent on mount (FW-97)', () => {
  it('calls loadForEvent with the event id on mount', async () => {
    render(<AttendanceTracker event={makeEvent()} />);
    await waitFor(() => {
      expect(mockLoadForEvent).toHaveBeenCalledWith('event-1');
    });
  });

  it('calls loadForEvent again when eventId changes', async () => {
    const event1 = makeEvent({ id: 'event-1' });
    const event2 = makeEvent({ id: 'event-2', title: 'Game 2' });

    const { rerender } = render(<AttendanceTracker event={event1} />);
    await waitFor(() => expect(mockLoadForEvent).toHaveBeenCalledWith('event-1'));

    rerender(<AttendanceTracker event={event2} />);
    await waitFor(() => expect(mockLoadForEvent).toHaveBeenCalledWith('event-2'));
  });
});

// ── B. Pre-fill from store RSVPs ─────────────────────────────────────────────

describe('AttendanceTracker — pre-fill uses subcollection store data (FW-97)', () => {
  it('shows Pre-fill button when store has RSVP entries and no attendance recorded', () => {
    mockStoreRsvps = {
      'event-1': [
        { uid: 'uid-a', playerId: 'p1', name: 'Player p1', response: 'yes', updatedAt: '2026-01-01' },
      ],
    };
    render(<AttendanceTracker event={makeEvent({ attendance: [] })} />);
    expect(screen.getByRole('button', { name: /pre-fill from rsvps/i })).toBeInTheDocument();
  });

  it('calls updateEvent with correct attendance statuses when pre-filling from store RSVPs', async () => {
    mockPlayers = [makePlayer('p1'), makePlayer('p2'), makePlayer('p3')];
    mockStoreRsvps = {
      'event-1': [
        { uid: 'uid-a', playerId: 'p1', name: 'P1', response: 'yes', updatedAt: '2026-01-01' },
        { uid: 'uid-b', playerId: 'p2', name: 'P2', response: 'no', updatedAt: '2026-01-01' },
        { uid: 'uid-c', playerId: 'p3', name: 'P3', response: 'maybe', updatedAt: '2026-01-01' },
      ],
    };
    const user = userEvent.setup();
    render(<AttendanceTracker event={makeEvent({ attendance: [] })} />);

    await user.click(screen.getByRole('button', { name: /pre-fill from rsvps/i }));

    expect(mockUpdateEvent).toHaveBeenCalledOnce();
    const updated = mockUpdateEvent.mock.calls[0][0] as ScheduledEvent;
    const attendance = updated.attendance ?? [];

    expect(attendance.find(a => a.playerId === 'p1')?.status).toBe('present');
    expect(attendance.find(a => a.playerId === 'p2')?.status).toBe('absent');
    expect(attendance.find(a => a.playerId === 'p3')?.status).toBe('excused');
  });

  it('skips RSVP entries with no playerId when pre-filling', async () => {
    mockStoreRsvps = {
      'event-1': [
        { uid: 'uid-a', name: 'No ID Player', response: 'yes', updatedAt: '2026-01-01' },
      ],
    };
    const user = userEvent.setup();
    render(<AttendanceTracker event={makeEvent({ attendance: [] })} />);

    // Button appears because store has entries
    await user.click(screen.getByRole('button', { name: /pre-fill from rsvps/i }));

    const updated = mockUpdateEvent.mock.calls[0][0] as ScheduledEvent;
    // No entries with undefined playerId should appear in attendance
    expect(updated.attendance).toHaveLength(0);
  });
});

// ── C. Pre-fill absent when no RSVPs ─────────────────────────────────────────

describe('AttendanceTracker — no pre-fill button when store has no RSVPs (FW-97)', () => {
  it('hides Pre-fill button when store has no entry for the event', () => {
    mockStoreRsvps = {};
    render(<AttendanceTracker event={makeEvent({ attendance: [] })} />);
    expect(screen.queryByRole('button', { name: /pre-fill from rsvps/i })).not.toBeInTheDocument();
  });
});
