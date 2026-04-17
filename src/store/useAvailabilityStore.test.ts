/**
 * useAvailabilityStore — unit tests
 *
 * Behaviors under test:
 *   - loadAvailability subscribes and populates availability keyed by playerId
 *   - loadAvailability sets loadedTeamId on success and on error
 *   - setUnavailable writes to Firestore and optimistically updates store state
 *   - isPlayerAvailable returns true when player has no availability doc
 *   - isPlayerAvailable returns false when date falls within an unavailability window
 *   - isPlayerAvailable returns true when date is outside all windows
 *   - isPlayerAvailable handles exact boundary dates (startDate and endDate inclusive)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AvailabilityDoc, UnavailableWindow } from './useAvailabilityStore';

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockSetDoc = vi.fn();
const mockOnSnapshot = vi.fn(() => () => {});
const mockDoc = vi.fn(() => ({}));
const mockCollection = vi.fn(() => ({}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

// ── Import store after mocks ──────────────────────────────────────────────────

import { useAvailabilityStore } from './useAvailabilityStore';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeWindow(startDate: string, endDate: string, reason?: string): UnavailableWindow {
  return { id: `w-${startDate}`, startDate, endDate, reason };
}

function makeAvailabilityDoc(playerId: string, windows: UnavailableWindow[]): AvailabilityDoc {
  return { playerId, windows, updatedAt: '2026-01-01T00:00:00.000Z' };
}

function makeSnapshot(docs: AvailabilityDoc[]) {
  return { docs: docs.map(d => ({ data: () => d })) };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  useAvailabilityStore.setState({ availability: {}, loadedTeamId: null });
});

// ── loadAvailability() ────────────────────────────────────────────────────────

describe('useAvailabilityStore — loadAvailability', () => {
  it('populates availability keyed by playerId from snapshot', () => {
    const docs = [
      makeAvailabilityDoc('player-A', [makeWindow('2026-06-01', '2026-06-07')]),
      makeAvailabilityDoc('player-B', []),
    ];
    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb(makeSnapshot(docs));
      return () => {};
    });

    useAvailabilityStore.getState().loadAvailability('team-1');
    const state = useAvailabilityStore.getState().availability;
    expect(Object.keys(state)).toHaveLength(2);
    expect(state['player-A'].windows).toHaveLength(1);
    expect(state['player-B'].windows).toHaveLength(0);
  });

  it('sets loadedTeamId after successful snapshot', () => {
    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb(makeSnapshot([]));
      return () => {};
    });
    useAvailabilityStore.getState().loadAvailability('team-42');
    expect(useAvailabilityStore.getState().loadedTeamId).toBe('team-42');
  });

  it('sets loadedTeamId on snapshot error', () => {
    mockOnSnapshot.mockImplementation((_ref, _cb, errCb) => {
      errCb(new Error('Network error'));
      return () => {};
    });
    useAvailabilityStore.getState().loadAvailability('team-42');
    expect(useAvailabilityStore.getState().loadedTeamId).toBe('team-42');
  });

  it('returns an unsubscribe function', () => {
    const unsub = vi.fn();
    mockOnSnapshot.mockReturnValue(unsub);
    const result = useAvailabilityStore.getState().loadAvailability('team-1');
    expect(typeof result).toBe('function');
  });
});

// ── setUnavailable() ──────────────────────────────────────────────────────────

describe('useAvailabilityStore — setUnavailable', () => {
  it('calls setDoc once', async () => {
    await useAvailabilityStore.getState().setUnavailable('team-1', 'player-A', []);
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('optimistically updates store state before Firestore confirms', async () => {
    const windows = [makeWindow('2026-07-01', '2026-07-14', 'Vacation')];
    await useAvailabilityStore.getState().setUnavailable('team-1', 'player-A', windows);
    const stored = useAvailabilityStore.getState().availability['player-A'];
    expect(stored).toBeDefined();
    expect(stored.playerId).toBe('player-A');
    expect(stored.windows).toHaveLength(1);
    expect(stored.windows[0].reason).toBe('Vacation');
  });

  it('does not clobber availability for other players', async () => {
    useAvailabilityStore.setState({
      availability: {
        'player-B': makeAvailabilityDoc('player-B', [makeWindow('2026-01-01', '2026-01-07')]),
      },
    });
    await useAvailabilityStore.getState().setUnavailable('team-1', 'player-A', []);
    expect(useAvailabilityStore.getState().availability['player-B']).toBeDefined();
  });

  it('propagates Firestore errors', async () => {
    mockSetDoc.mockRejectedValue(new Error('Permission denied'));
    await expect(
      useAvailabilityStore.getState().setUnavailable('team-1', 'player-A', [])
    ).rejects.toThrow('Permission denied');
  });
});

// ── isPlayerAvailable() ───────────────────────────────────────────────────────

describe('useAvailabilityStore — isPlayerAvailable', () => {
  it('returns true when player has no availability doc', () => {
    expect(useAvailabilityStore.getState().isPlayerAvailable('unknown-player', '2026-06-15')).toBe(true);
  });

  it('returns true when date is outside all unavailability windows', () => {
    useAvailabilityStore.setState({
      availability: {
        'player-A': makeAvailabilityDoc('player-A', [
          makeWindow('2026-06-01', '2026-06-07'),
        ]),
      },
    });
    expect(useAvailabilityStore.getState().isPlayerAvailable('player-A', '2026-06-10')).toBe(true);
  });

  it('returns false when date falls within a window', () => {
    useAvailabilityStore.setState({
      availability: {
        'player-A': makeAvailabilityDoc('player-A', [
          makeWindow('2026-06-01', '2026-06-30'),
        ]),
      },
    });
    expect(useAvailabilityStore.getState().isPlayerAvailable('player-A', '2026-06-15')).toBe(false);
  });

  it('returns false on the window startDate (inclusive boundary)', () => {
    useAvailabilityStore.setState({
      availability: {
        'player-A': makeAvailabilityDoc('player-A', [
          makeWindow('2026-06-10', '2026-06-20'),
        ]),
      },
    });
    expect(useAvailabilityStore.getState().isPlayerAvailable('player-A', '2026-06-10')).toBe(false);
  });

  it('returns false on the window endDate (inclusive boundary)', () => {
    useAvailabilityStore.setState({
      availability: {
        'player-A': makeAvailabilityDoc('player-A', [
          makeWindow('2026-06-10', '2026-06-20'),
        ]),
      },
    });
    expect(useAvailabilityStore.getState().isPlayerAvailable('player-A', '2026-06-20')).toBe(false);
  });

  it('returns true when player has an empty windows array', () => {
    useAvailabilityStore.setState({
      availability: {
        'player-A': makeAvailabilityDoc('player-A', []),
      },
    });
    expect(useAvailabilityStore.getState().isPlayerAvailable('player-A', '2026-06-15')).toBe(true);
  });
});
