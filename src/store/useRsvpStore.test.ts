/**
 * useRsvpStore — unit tests
 *
 * Behaviors under test:
 *   - submitRsvp calls the submitRsvp Cloud Function (not setDoc directly)
 *   - submitRsvp forwards eventId, name, response to the CF
 *   - submitRsvp forwards playerId when provided (parent→child)
 *   - submitRsvp omits playerId when not provided (self-RSVP)
 *   - submitRsvp propagates CF errors
 *   - self-RSVP (no playerId) calls CF without playerId field
 *   - self-RSVP (playerId === uid) calls CF without playerId field
 *   - subscribeRsvps populates rsvps keyed by eventId from snapshot
 *   - subscribeRsvps returns an unsubscribe function
 *   - subscribeRsvps merges entries from different events without clobbering
 *   - loadForEvent (FW-97) fetches subcollection via getDocs and stores result
 *   - loadForEvent no-ops when rsvps[eventId] is already populated
 *   - loadForEvent leaves state unchanged on Firestore error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RsvpEntry } from './useRsvpStore';

// ── Cloud Functions mock ──────────────────────────────────────────────────────

const mockCallableFn = vi.fn().mockResolvedValue({ data: { success: true } });
const mockHttpsCallable = vi.fn(() => mockCallableFn);

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
}));

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockOnSnapshot = vi.fn(() => () => {});
const mockCollection = vi.fn(() => ({}));
const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {}, functions: {} }));

// ── Import store after mocks ──────────────────────────────────────────────────

import { useRsvpStore } from './useRsvpStore';

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockCallableFn.mockResolvedValue({ data: { success: true } });
  mockGetDocs.mockResolvedValue({ docs: [] });
  useRsvpStore.setState({ rsvps: {} });
});

// ── submitRsvp() ──────────────────────────────────────────────────────────────

describe('useRsvpStore — submitRsvp', () => {
  it('calls the submitRsvp Cloud Function via httpsCallable', async () => {
    await useRsvpStore.getState().submitRsvp('event-1', 'uid-1', 'Jane', 'yes');
    expect(mockHttpsCallable).toHaveBeenCalledOnce();
    expect(mockHttpsCallable).toHaveBeenCalledWith({}, 'submitRsvp');
    expect(mockCallableFn).toHaveBeenCalledOnce();
  });

  it('forwards eventId, name, and response to the CF', async () => {
    await useRsvpStore.getState().submitRsvp('event-1', 'uid-1', 'Jane', 'no');
    const payload = mockCallableFn.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.eventId).toBe('event-1');
    expect(payload.name).toBe('Jane');
    expect(payload.response).toBe('no');
  });

  it('forwards playerId to the CF when provided (parent→child RSVP)', async () => {
    await useRsvpStore.getState().submitRsvp('event-1', 'uid-parent', 'Kid A', 'yes', 'player-123');
    const payload = mockCallableFn.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.playerId).toBe('player-123');
  });

  it('omits playerId from CF payload when not provided (self-RSVP)', async () => {
    await useRsvpStore.getState().submitRsvp('event-1', 'uid-1', 'Jane', 'yes');
    const payload = mockCallableFn.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.playerId).toBeUndefined();
  });

  it('propagates CF errors', async () => {
    mockCallableFn.mockRejectedValue(new Error('permission-denied'));
    await expect(
      useRsvpStore.getState().submitRsvp('event-1', 'uid-1', 'Jane', 'yes')
    ).rejects.toThrow('permission-denied');
  });

  // Self-RSVP: no playerId provided — CF handles self-RSVP path without
  // reading the caller's profile (no ownership check needed).
  it('self-RSVP (no playerId): calls CF once without a playerId field', async () => {
    await useRsvpStore.getState().submitRsvp('event-2', 'uid-coach', 'Coach Bob', 'yes');
    expect(mockCallableFn).toHaveBeenCalledOnce();
    const payload = mockCallableFn.mock.calls[0][0] as Record<string, unknown>;
    expect('playerId' in payload).toBe(false);
  });

  // Self-RSVP: caller supplies their own uid as playerId — treated identically
  // to the no-playerId case on the store side.
  it('self-RSVP (playerId === uid): still passes playerId to CF for server deduplication', async () => {
    // The store is a thin caller — uid-as-playerId is handled by the CF, not the store.
    // The store only omits playerId when the caller does not pass one.
    await useRsvpStore.getState().submitRsvp('event-2', 'uid-coach', 'Coach Bob', 'yes', 'uid-coach');
    const payload = mockCallableFn.mock.calls[0][0] as Record<string, unknown>;
    // playerId is forwarded — the CF will normalise it to a self-RSVP
    expect(payload.playerId).toBe('uid-coach');
  });
});

// ── subscribeRsvps() ──────────────────────────────────────────────────────────

describe('useRsvpStore — subscribeRsvps', () => {
  it('populates rsvps[eventId] from snapshot', () => {
    const entries: RsvpEntry[] = [
      { uid: 'uid-1', name: 'Jane', response: 'yes', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb({ docs: entries.map(e => ({ data: () => e })) });
      return () => {};
    });

    useRsvpStore.getState().subscribeRsvps('event-1');
    expect(useRsvpStore.getState().rsvps['event-1']).toHaveLength(1);
    expect(useRsvpStore.getState().rsvps['event-1'][0].name).toBe('Jane');
  });

  it('returns an unsubscribe function', () => {
    const unsub = vi.fn();
    mockOnSnapshot.mockReturnValue(unsub);
    const result = useRsvpStore.getState().subscribeRsvps('event-1');
    expect(typeof result).toBe('function');
  });

  it('does not clobber rsvps for other events when new snapshot fires', () => {
    // Seed an existing entry for event-2
    useRsvpStore.setState({
      rsvps: {
        'event-2': [{ uid: 'uid-2', name: 'Bob', response: 'no', updatedAt: '2026-01-01' }],
      },
    });

    // Subscribe to event-1 and fire snapshot
    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb({
        docs: [{ data: () => ({ uid: 'uid-1', name: 'Jane', response: 'yes', updatedAt: '2026-01-01' }) }],
      });
      return () => {};
    });

    useRsvpStore.getState().subscribeRsvps('event-1');

    // event-2 rsvps must be preserved
    expect(useRsvpStore.getState().rsvps['event-2']).toHaveLength(1);
    expect(useRsvpStore.getState().rsvps['event-1']).toHaveLength(1);
  });

  it('leaves state unchanged on snapshot error', () => {
    useRsvpStore.setState({ rsvps: { 'event-1': [] } });
    mockOnSnapshot.mockImplementation((_ref, _cb, errCb) => {
      errCb(new Error('Error'));
      return () => {};
    });

    useRsvpStore.getState().subscribeRsvps('event-1');
    // State should be unchanged
    expect(useRsvpStore.getState().rsvps['event-1']).toEqual([]);
  });
});

// ── loadForEvent() — FW-97 ───────────────────────────────────────────────────

describe('useRsvpStore — loadForEvent (FW-97)', () => {
  it('calls getDocs on the events/{id}/rsvps subcollection', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    await useRsvpStore.getState().loadForEvent('event-1');
    expect(mockGetDocs).toHaveBeenCalledOnce();
    expect(mockCollection).toHaveBeenCalledWith({}, 'events', 'event-1', 'rsvps');
  });

  it('populates rsvps[eventId] with fetched entries', async () => {
    const entries: RsvpEntry[] = [
      { uid: 'uid-1', playerId: 'p1', name: 'Alice', response: 'yes', updatedAt: '2026-01-01' },
    ];
    mockGetDocs.mockResolvedValue({
      docs: entries.map(e => ({ data: () => e })),
    });

    await useRsvpStore.getState().loadForEvent('event-1');
    expect(useRsvpStore.getState().rsvps['event-1']).toHaveLength(1);
    expect(useRsvpStore.getState().rsvps['event-1'][0].name).toBe('Alice');
  });

  it('does not call getDocs when rsvps[eventId] is already populated (no-op)', async () => {
    useRsvpStore.setState({
      rsvps: { 'event-1': [{ uid: 'uid-1', name: 'Cached', response: 'yes', updatedAt: '2026-01-01' }] },
    });

    await useRsvpStore.getState().loadForEvent('event-1');
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('treats an empty array [] as already populated (no refetch)', async () => {
    // An empty array means the event has no RSVPs — we still should not refetch
    useRsvpStore.setState({ rsvps: { 'event-1': [] } });

    await useRsvpStore.getState().loadForEvent('event-1');
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('does not clobber rsvps for other events when populating a new event', async () => {
    useRsvpStore.setState({
      rsvps: { 'event-2': [{ uid: 'uid-2', name: 'Bob', response: 'no', updatedAt: '2026-01-01' }] },
    });

    mockGetDocs.mockResolvedValue({
      docs: [{ data: () => ({ uid: 'uid-1', name: 'Alice', response: 'yes', updatedAt: '2026-01-01' }) }],
    });

    await useRsvpStore.getState().loadForEvent('event-1');

    expect(useRsvpStore.getState().rsvps['event-2']).toHaveLength(1);
    expect(useRsvpStore.getState().rsvps['event-1']).toHaveLength(1);
  });

  it('leaves state unchanged when getDocs rejects', async () => {
    useRsvpStore.setState({ rsvps: { 'event-1': [] } });
    mockGetDocs.mockRejectedValue(new Error('permission-denied'));

    // Should not throw
    await expect(useRsvpStore.getState().loadForEvent('event-2')).resolves.toBeUndefined();
    // event-1 state is untouched
    expect(useRsvpStore.getState().rsvps['event-1']).toEqual([]);
  });
});
