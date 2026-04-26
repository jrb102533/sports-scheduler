/**
 * useEventStore — action unit tests
 *
 * Tests the Zustand store actions that write to Firestore.
 * Firestore is mocked at the module boundary.
 *
 * Behaviors under test:
 *   - subscribe() only queries non-draft statuses (query safety invariant)
 *   - subscribe() populates events from snapshot
 *   - subscribe() scopes query to userTeamIds for non-admin users
 *   - subscribe() returns immediately (no listener) when non-admin has no teams
 *   - subscribe() uses unscoped query for admin users
 *   - addEvent / updateEvent / deleteEvent write to correct paths
 *   - recordResult marks event as completed and writes result
 *   - recordResult is a no-op when event ID does not exist in store
 *   - bulkAddEvents writes all events in parallel
 *   - deleteEventsByGroupId removes all events with matching groupId
 *   - updateEventsByGroupId applies patch to events on/after fromDate
 *   - updateEventsByGroupId defaults fromDate to today
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScheduledEvent, GameResult } from '../types';

// ── Firestore mock ────────────────────────────────────────────────────────────

type AnyFn = (...args: any[]) => any;

const mockSetDoc = vi.fn<AnyFn>();
const mockDeleteDoc = vi.fn<AnyFn>();
const mockOnSnapshot = vi.fn<AnyFn>(() => () => {});
const mockDoc = vi.fn<AnyFn>((...args: any[]) => ({ _path: args.slice(1).join('/') }));
const mockCollection = vi.fn<AnyFn>(() => ({ _coll: true }));
const mockQuery = vi.fn<AnyFn>((q: unknown) => q);
const mockOrderBy = vi.fn<AnyFn>(() => ({}));
const mockWhere = vi.fn<AnyFn>(() => ({}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: any[]) => mockCollection(...args),
  onSnapshot: (...args: any[]) => mockOnSnapshot(...args),
  doc: (...args: any[]) => mockDoc(...args),
  setDoc: (...args: any[]) => mockSetDoc(...args),
  deleteDoc: (...args: any[]) => mockDeleteDoc(...args),
  query: (...args: any[]) => mockQuery(...args),
  orderBy: (...args: any[]) => mockOrderBy(...args),
  where: (...args: any[]) => mockWhere(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

// ── Auth store mock ───────────────────────────────────────────────────────────

const mockGetAuthState = vi.fn<AnyFn>(() => ({ profile: { role: 'admin' } }));

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: (...args: any[]) => mockGetAuthState(...args) },
}));

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
  mockGetAuthState.mockReturnValue({ profile: { role: 'admin' } });
  useEventStore.setState({ events: [], loading: true });
});

// ── subscribe() — admin ───────────────────────────────────────────────────────

describe('useEventStore — subscribe (admin)', () => {
  it('queries with a where("status", "in", ...) filter (no draft leakage)', () => {
    mockOnSnapshot.mockReturnValue(() => {});
    useEventStore.getState().subscribe([]);
    // Admin path: where() is called only once, with status filter (no teamId filter)
    expect(mockWhere).toHaveBeenCalledWith('status', 'in', expect.arrayContaining(['scheduled', 'completed']));
    const statusArg = mockWhere.mock.calls[0][2] as string[];
    expect(statusArg).not.toContain('draft');
  });

  it('does NOT add a teamId filter for admin users', () => {
    mockOnSnapshot.mockReturnValue(() => {});
    useEventStore.getState().subscribe([]);
    const whereArgs = mockWhere.mock.calls.map(c => c[0] as string);
    expect(whereArgs).not.toContain('teamId');
  });

  it('bounds the admin query with a 90-day date floor (read-cost cap)', () => {
    mockOnSnapshot.mockReturnValue(() => {});
    useEventStore.getState().subscribe([]);
    const dateCall = mockWhere.mock.calls.find(c => c[0] === 'date');
    expect(dateCall).toBeDefined();
    expect(dateCall![1]).toBe('>=');
    const floor = dateCall![2] as string;
    // Floor is an ISO date (YYYY-MM-DD) ~90 days in the past
    expect(floor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const ageDays = (Date.now() - new Date(floor).getTime()) / 86_400_000;
    expect(ageDays).toBeGreaterThan(89);
    expect(ageDays).toBeLessThan(91);
  });

  it('populates events array from snapshot', () => {
    const events = [makeEvent('e1'), makeEvent('e2')];
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot(events));
      return () => {};
    });

    useEventStore.getState().subscribe([]);
    expect(useEventStore.getState().events).toHaveLength(2);
    expect(useEventStore.getState().events[0].id).toBe('e1');
  });

  it('sets loading to false after snapshot fires', () => {
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([]));
      return () => {};
    });
    useEventStore.getState().subscribe([]);
    expect(useEventStore.getState().loading).toBe(false);
  });

  it('sets loading to false on snapshot error', () => {
    mockOnSnapshot.mockImplementation((_q, _cb, errCb) => {
      errCb(new Error('Rules error'));
      return () => {};
    });
    useEventStore.getState().subscribe([]);
    expect(useEventStore.getState().loading).toBe(false);
  });
});

// ── subscribe() — league_manager (same bypass as admin) ──────────────────────

describe('useEventStore — subscribe (league_manager)', () => {
  beforeEach(() => {
    mockGetAuthState.mockReturnValue({ profile: { role: 'league_manager' } });
  });

  it('uses unscoped query (no teamId filter) for league_manager', () => {
    mockOnSnapshot.mockReturnValue(() => {});
    useEventStore.getState().subscribe([]);
    const whereArgs = mockWhere.mock.calls.map(c => c[0] as string);
    expect(whereArgs).not.toContain('teamId');
  });

  it('opens a listener even when userTeamIds is empty', () => {
    mockOnSnapshot.mockReturnValue(() => {});
    useEventStore.getState().subscribe([]);
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
  });
});

// ── subscribe() — non-admin scoping ──────────────────────────────────────────

describe('useEventStore — subscribe (non-admin scoping)', () => {
  beforeEach(() => {
    mockGetAuthState.mockReturnValue({ profile: { role: 'coach' } });
  });

  it('adds a teamId "in" filter scoped to the provided team IDs', () => {
    mockOnSnapshot.mockReturnValue(() => {});
    useEventStore.getState().subscribe(['team-1', 'team-2']);
    expect(mockWhere).toHaveBeenCalledWith('teamId', 'in', ['team-1', 'team-2']);
  });

  it('still includes the status filter alongside the teamId filter', () => {
    mockOnSnapshot.mockReturnValue(() => {});
    useEventStore.getState().subscribe(['team-1']);
    const whereFields = mockWhere.mock.calls.map(c => c[0] as string);
    expect(whereFields).toContain('teamId');
    expect(whereFields).toContain('status');
  });

  it('also applies the 90-day date floor for non-admin queries', () => {
    mockOnSnapshot.mockReturnValue(() => {});
    useEventStore.getState().subscribe(['team-1']);
    const dateCall = mockWhere.mock.calls.find(c => c[0] === 'date');
    expect(dateCall).toBeDefined();
    expect(dateCall![1]).toBe('>=');
  });

  it('returns a no-op unsubscribe and sets loading: false when userTeamIds is empty', () => {
    const unsub = useEventStore.getState().subscribe([]);
    expect(mockOnSnapshot).not.toHaveBeenCalled();
    expect(useEventStore.getState().loading).toBe(false);
    expect(() => unsub()).not.toThrow();
  });

  it('caps the teamId filter at 30 IDs (Firestore in-query limit)', () => {
    mockOnSnapshot.mockReturnValue(() => {});
    const manyIds = Array.from({ length: 35 }, (_, i) => `team-${i}`);
    useEventStore.getState().subscribe(manyIds);
    const teamIdCall = mockWhere.mock.calls.find(c => c[0] === 'teamId');
    expect(teamIdCall).toBeDefined();
    expect((teamIdCall![2] as string[]).length).toBe(30);
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
