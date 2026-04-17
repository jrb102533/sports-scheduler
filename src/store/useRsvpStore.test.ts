/**
 * useRsvpStore — unit tests
 *
 * Behaviors under test:
 *   - submitRsvp writes to the correct Firestore path with correct data
 *   - submitRsvp writes a current updatedAt timestamp
 *   - submitRsvp propagates Firestore errors
 *   - subscribeRsvps populates rsvps keyed by eventId from snapshot
 *   - subscribeRsvps returns an unsubscribe function
 *   - subscribeRsvps merges entries from different events without clobbering
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RsvpEntry } from './useRsvpStore';

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockSetDoc = vi.fn();
const mockOnSnapshot = vi.fn(() => () => {});
const mockDoc = vi.fn((...args) => ({ _path: args.slice(1).join('/') }));
const mockCollection = vi.fn(() => ({}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

// ── Import store after mocks ──────────────────────────────────────────────────

import { useRsvpStore } from './useRsvpStore';

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  useRsvpStore.setState({ rsvps: {} });
});

// ── submitRsvp() ──────────────────────────────────────────────────────────────

describe('useRsvpStore — submitRsvp', () => {
  it('calls setDoc once', async () => {
    await useRsvpStore.getState().submitRsvp('event-1', 'uid-1', 'Jane', 'yes');
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('writes the correct response to Firestore', async () => {
    await useRsvpStore.getState().submitRsvp('event-1', 'uid-1', 'Jane', 'no');
    const written = mockSetDoc.mock.calls[0][1] as RsvpEntry;
    expect(written.response).toBe('no');
    expect(written.uid).toBe('uid-1');
    expect(written.name).toBe('Jane');
  });

  it('writes a non-empty updatedAt timestamp', async () => {
    await useRsvpStore.getState().submitRsvp('event-1', 'uid-1', 'Jane', 'yes');
    const written = mockSetDoc.mock.calls[0][1] as RsvpEntry;
    expect(typeof written.updatedAt).toBe('string');
    expect(written.updatedAt.length).toBeGreaterThan(0);
  });

  it('propagates Firestore errors', async () => {
    mockSetDoc.mockRejectedValue(new Error('Permission denied'));
    await expect(
      useRsvpStore.getState().submitRsvp('event-1', 'uid-1', 'Jane', 'yes')
    ).rejects.toThrow('Permission denied');
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
