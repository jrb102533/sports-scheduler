/**
 * useOpponentStore — unit tests
 *
 * Behaviors under test:
 *   - subscribe() populates opponents from snapshot, sets loading: false
 *   - subscribe() sets loading: false on error
 *   - addOpponent / updateOpponent call setDoc
 *   - deleteOpponent calls deleteDoc
 *   - Error propagation from Firestore
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Opponent } from '@/types';

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockSetDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockOnSnapshot = vi.fn(() => () => {});
const mockDoc = vi.fn(() => ({}));
const mockCollection = vi.fn(() => ({}));
const mockQuery = vi.fn(q => q);
const mockOrderBy = vi.fn(() => ({}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

// ── Import store after mocks ──────────────────────────────────────────────────

import { useOpponentStore } from './useOpponentStore';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeOpponent(id: string): Opponent {
  return {
    id,
    name: `Opponent ${id}`,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as Opponent;
}

function makeSnapshot(opponents: Opponent[]) {
  return { docs: opponents.map(o => ({ id: o.id, data: () => o })) };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  mockDeleteDoc.mockResolvedValue(undefined);
  useOpponentStore.setState({ opponents: [], loading: true });
});

// ── subscribe() ───────────────────────────────────────────────────────────────

describe('useOpponentStore — subscribe', () => {
  it('populates opponents from snapshot', () => {
    const opponents = [makeOpponent('o1'), makeOpponent('o2')];
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot(opponents));
      return () => {};
    });

    useOpponentStore.getState().subscribe();
    expect(useOpponentStore.getState().opponents).toHaveLength(2);
    expect(useOpponentStore.getState().opponents[0].id).toBe('o1');
  });

  it('sets loading: false after snapshot fires', () => {
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([]));
      return () => {};
    });
    useOpponentStore.getState().subscribe();
    expect(useOpponentStore.getState().loading).toBe(false);
  });

  it('sets loading: false on snapshot error', () => {
    mockOnSnapshot.mockImplementation((_q, _cb, errCb) => {
      errCb(new Error('Network error'));
      return () => {};
    });
    useOpponentStore.getState().subscribe();
    expect(useOpponentStore.getState().loading).toBe(false);
  });
});

// ── addOpponent() ─────────────────────────────────────────────────────────────

describe('useOpponentStore — addOpponent', () => {
  it('calls setDoc once', async () => {
    await useOpponentStore.getState().addOpponent(makeOpponent('o1'));
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('propagates Firestore errors', async () => {
    mockSetDoc.mockRejectedValue(new Error('Write failed'));
    await expect(useOpponentStore.getState().addOpponent(makeOpponent('o1'))).rejects.toThrow('Write failed');
  });
});

// ── updateOpponent() ──────────────────────────────────────────────────────────

describe('useOpponentStore — updateOpponent', () => {
  it('calls setDoc with the updated opponent', async () => {
    const opp = makeOpponent('o1');
    await useOpponentStore.getState().updateOpponent({ ...opp, name: 'Renamed' });
    expect(mockSetDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'Renamed' }));
  });
});

// ── deleteOpponent() ──────────────────────────────────────────────────────────

describe('useOpponentStore — deleteOpponent', () => {
  it('calls deleteDoc once', async () => {
    await useOpponentStore.getState().deleteOpponent('o1');
    expect(mockDeleteDoc).toHaveBeenCalledOnce();
  });

  it('propagates Firestore errors', async () => {
    mockDeleteDoc.mockRejectedValue(new Error('Not found'));
    await expect(useOpponentStore.getState().deleteOpponent('o1')).rejects.toThrow('Not found');
  });
});
