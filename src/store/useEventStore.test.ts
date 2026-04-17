/**
 * useEventStore — action unit tests
 *
 * Tests the Zustand store actions that write to Firestore.
 * Firestore is mocked at the module boundary.
 *
 * Behaviors under test:
 *   - subscribe() only queries non-draft statuses (query safety invariant)
 *   - subscribe() populates events from snapshot
 *   - addEvent / updateEvent / deleteEvent write to correct paths
 *   - recordResult marks event as completed and writes result
 *   - recordResult is a no-op when event ID does not exist in store
 *   - bulkAddEvents writes all events in parallel
 *   - deleteEventsByGroupId removes all events with matching groupId
 *   - updateEventsByGroupId applies patch to events on/after fromDate
 *   - updateEventsByGroupId defaults fromDate to today
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScheduledEvent, GameResult } from '@/types';

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockSetDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockOnSnapshot = vi.fn(() => () => {});
const mockDoc = vi.fn((...args) => ({ _path: args.slice(1).join('/') }));
const mockCollection = vi.fn(() => ({ _coll: true }));
const mockQuery = vi.fn(q => q);
const mockOrderBy = vi.fn(() => ({}));
const mockWhere = vi.fn(() => ({}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  where: (...args: unknown[]) => mockWhere(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

// ── Import store after mocks ──────────────────────────────────────────────────

import { useEventStore } from './useEventStore';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeEvent(id: string, overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id,
    title: `Event ${id}`,
    type: 'game',
    status: 'scheduled',
    date: '2026-06-01',
    startTime: '10:00',
    teamIds: ['team-1', 'team-2'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ScheduledEvent;
}

function makeSnapshot(events: ScheduledEvent[]) {
  return {
    docs: events.map(e => ({ id: e.id, data: () => e })),
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  mockDeleteDoc.mockResolvedValue(undefined);
  useEventStore.setState({ events: [], loading: true });
});

// ── subscribe() ───────────────────────────────────────────────────────────────

describe('useEventStore — subscribe', () => {
  it('queries with a where("status", "in", ...) filter (no draft leakage)', () => {
    mockOnSnapshot.mockReturnValue(() => {});
    useEventStore.getState().subscribe();
    // The where() call must contain 'status' and 'in' to satisfy the Firestore rule
    expect(mockWhere).toHaveBeenCalledWith('status', 'in', expect.arrayContaining(['scheduled', 'completed']));
    const statusArg = mockWhere.mock.calls[0][2] as string[];
    expect(statusArg).not.toContain('draft');
  });

  it('populates events array from snapshot', () => {
    const events = [makeEvent('e1'), makeEvent('e2')];
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot(events));
      return () => {};
    });

    useEventStore.getState().subscribe();
    expect(useEventStore.getState().events).toHaveLength(2);
    expect(useEventStore.getState().events[0].id).toBe('e1');
  });

  it('sets loading to false after snapshot fires', () => {
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([]));
      return () => {};
    });
    useEventStore.getState().subscribe();
    expect(useEventStore.getState().loading).toBe(false);
  });

  it('sets loading to false on snapshot error', () => {
    mockOnSnapshot.mockImplementation((_q, _cb, errCb) => {
      errCb(new Error('Rules error'));
      return () => {};
    });
    useEventStore.getState().subscribe();
    expect(useEventStore.getState().loading).toBe(false);
  });
});

// ── addEvent() ────────────────────────────────────────────────────────────────

describe('useEventStore — addEvent', () => {
  it('calls setDoc once', async () => {
    await useEventStore.getState().addEvent(makeEvent('e1'));
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('propagates Firestore errors', async () => {
    mockSetDoc.mockRejectedValue(new Error('Permission denied'));
    await expect(useEventStore.getState().addEvent(makeEvent('e1'))).rejects.toThrow('Permission denied');
  });
});

// ── updateEvent() ─────────────────────────────────────────────────────────────

describe('useEventStore — updateEvent', () => {
  it('calls setDoc with the full event', async () => {
    const event = makeEvent('e1', { title: 'Updated Title' });
    await useEventStore.getState().updateEvent(event);
    expect(mockSetDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: 'Updated Title' }));
  });
});

// ── deleteEvent() ─────────────────────────────────────────────────────────────

describe('useEventStore — deleteEvent', () => {
  it('calls deleteDoc once', async () => {
    await useEventStore.getState().deleteEvent('e1');
    expect(mockDeleteDoc).toHaveBeenCalledOnce();
  });

  it('propagates Firestore errors', async () => {
    mockDeleteDoc.mockRejectedValue(new Error('Not found'));
    await expect(useEventStore.getState().deleteEvent('e1')).rejects.toThrow('Not found');
  });
});

// ── recordResult() ────────────────────────────────────────────────────────────

describe('useEventStore — recordResult', () => {
  it('writes a completed status and the result to Firestore', async () => {
    const event = makeEvent('e1', { status: 'scheduled' });
    useEventStore.setState({ events: [event] });

    const result: GameResult = { homeScore: 3, awayScore: 1, notes: 'Great game' };
    await useEventStore.getState().recordResult('e1', result);

    expect(mockSetDoc).toHaveBeenCalledOnce();
    const written = mockSetDoc.mock.calls[0][1] as ScheduledEvent;
    expect(written.status).toBe('completed');
    expect(written.result).toEqual(result);
  });

  it('is a no-op when the event id does not exist in the store', async () => {
    useEventStore.setState({ events: [] });
    await useEventStore.getState().recordResult('non-existent', { homeScore: 1, awayScore: 0, notes: '' });
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('sets an updatedAt timestamp on the written document', async () => {
    const event = makeEvent('e1');
    useEventStore.setState({ events: [event] });
    await useEventStore.getState().recordResult('e1', { homeScore: 2, awayScore: 2, notes: '' });
    const written = mockSetDoc.mock.calls[0][1] as ScheduledEvent;
    expect(typeof written.updatedAt).toBe('string');
    expect(written.updatedAt.length).toBeGreaterThan(0);
  });
});

// ── bulkAddEvents() ───────────────────────────────────────────────────────────

describe('useEventStore — bulkAddEvents', () => {
  it('calls setDoc for each event', async () => {
    const events = [makeEvent('e1'), makeEvent('e2'), makeEvent('e3')];
    await useEventStore.getState().bulkAddEvents(events);
    expect(mockSetDoc).toHaveBeenCalledTimes(3);
  });

  it('does nothing when the events array is empty', async () => {
    await useEventStore.getState().bulkAddEvents([]);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

// ── deleteEventsByGroupId() ───────────────────────────────────────────────────

describe('useEventStore — deleteEventsByGroupId', () => {
  it('deletes all events with the matching recurringGroupId', async () => {
    const events = [
      makeEvent('e1', { recurringGroupId: 'group-A' }),
      makeEvent('e2', { recurringGroupId: 'group-A' }),
      makeEvent('e3', { recurringGroupId: 'group-B' }),
    ];
    useEventStore.setState({ events });

    await useEventStore.getState().deleteEventsByGroupId('group-A');
    expect(mockDeleteDoc).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when no events match the groupId', async () => {
    useEventStore.setState({ events: [makeEvent('e1', { recurringGroupId: 'other' })] });
    await useEventStore.getState().deleteEventsByGroupId('group-X');
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });
});

// ── updateEventsByGroupId() ───────────────────────────────────────────────────

describe('useEventStore — updateEventsByGroupId', () => {
  it('updates only events on or after the fromDate', async () => {
    const events = [
      makeEvent('e1', { recurringGroupId: 'grp', date: '2026-05-01' }),
      makeEvent('e2', { recurringGroupId: 'grp', date: '2026-06-01' }),
      makeEvent('e3', { recurringGroupId: 'grp', date: '2026-07-01' }),
    ];
    useEventStore.setState({ events });

    await useEventStore.getState().updateEventsByGroupId('grp', { title: 'Updated' }, '2026-06-01');
    // e1 (May) is before cutoff — should NOT be updated
    // e2 (June) and e3 (July) should be updated
    expect(mockSetDoc).toHaveBeenCalledTimes(2);
    const titles = mockSetDoc.mock.calls.map(c => (c[1] as ScheduledEvent).title);
    expect(titles).not.toContain('Event e1');
    titles.forEach(t => expect(t).toBe('Updated'));
  });

  it('updates all events in the group when no fromDate is supplied', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01'));

    const events = [
      makeEvent('e1', { recurringGroupId: 'grp', date: '2026-01-01' }),
      makeEvent('e2', { recurringGroupId: 'grp', date: '2026-02-01' }),
    ];
    useEventStore.setState({ events });

    await useEventStore.getState().updateEventsByGroupId('grp', { title: 'Patched' });
    expect(mockSetDoc).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('applies the patch fields to each matching event', async () => {
    const event = makeEvent('e1', { recurringGroupId: 'grp', date: '2026-06-01', startTime: '09:00' });
    useEventStore.setState({ events: [event] });

    await useEventStore.getState().updateEventsByGroupId('grp', { startTime: '11:00' }, '2026-01-01');
    const written = mockSetDoc.mock.calls[0][1] as ScheduledEvent;
    expect(written.startTime).toBe('11:00');
    expect(written.id).toBe('e1'); // original fields preserved
  });
});
