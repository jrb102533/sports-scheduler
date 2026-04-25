/**
 * useOpponentStore — unit tests
 *
 * Behaviors under test:
 *   - subscribe() scopes to teamId "in" filter for non-admin users
 *   - subscribe() uses unscoped query for admin users
 *   - subscribe() returns immediately (no listener) when non-admin has no teams
 *   - subscribe() populates opponents from snapshot, sets loading: false
 *   - subscribe() sets loading: false on error
 *   - fetchForTeams() performs a one-shot getDocs scoped to teamIds
 *   - fetchForTeams() sets loading: false when teamIds is empty
 *   - addOpponent / updateOpponent call setDoc
 *   - deleteOpponent calls deleteDoc
 *   - Error propagation from Firestore
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Opponent } from '@/types';

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockSetDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockOnSnapshot = vi.fn(() => () => {});
const mockDoc = vi.fn(() => ({}));
const mockCollection = vi.fn(() => ({}));
const mockQuery = vi.fn(q => q);
const mockOrderBy = vi.fn(() => ({}));
const mockWhere = vi.fn(() => ({}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  where: (...args: unknown[]) => mockWhere(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

// ── Auth store mock ───────────────────────────────────────────────────────────

const mockGetAuthState = vi.fn(() => ({ profile: { role: 'admin' } }));

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: (...args: unknown[]) => mockGetAuthState(...args) },
}));

// ── Import store after mocks ──────────────────────────────────────────────────

import { useOpponentStore } from './useOpponentStore';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeOpponent(id: string): Opponent {
  return {
    id,
    name: `Opponent ${id}`,
    teamId: 'team-1',
    createdAt: '2024-01-01T00:00:00.000Z',
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
  mockGetAuthState.mockReturnValue({ profile: { role: 'admin' } });
  useOpponentStore.setState({ opponents: [], loading: true });
});

// ── subscribe() — admin ───────────────────────────────────────────────────────

describe('useOpponentStore — subscribe (admin)', () => {
  it('does NOT add a teamId filter for admin users', () => {
    mockOnSnapshot.mockReturnValue(() => {});
    useOpponentStore.getState().subscribe([]);
    const whereArgs = mockWhere.mock.calls.map(c => c[0] as string);
    expect(whereArgs).not.toContain('teamId');
  });

  it('populates opponents from snapshot', () => {
    const opponents = [makeOpponent('o1'), makeOpponent('o2')];
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot(opponents));
      return () => {};
    });

    useOpponentStore.getState().subscribe([]);
    expect(useOpponentStore.getState().opponents).toHaveLength(2);
    expect(useOpponentStore.getState().opponents[0].id).toBe('o1');
  });

  it('sets loading: false after snapshot fires', () => {
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([]));
      return () => {};
    });
    useOpponentStore.getState().subscribe([]);
    expect(useOpponentStore.getState().loading).toBe(false);
  });

  it('sets loading: false on snapshot error', () => {
    mockOnSnapshot.mockImplementation((_q, _cb, errCb) => {
      errCb(new Error('Network error'));
      return () => {};
    });
    useOpponentStore.getState().subscribe([]);
    expect(useOpponentStore.getState().loading).toBe(false);
  });
});

// ── subscribe() — non-admin scoping ──────────────────────────────────────────

describe('useOpponentStore — subscribe (non-admin scoping)', () => {
  beforeEach(() => {
    mockGetAuthState.mockReturnValue({ profile: { role: 'coach' } });
  });

  it('adds a teamId "in" filter scoped to the provided team IDs', () => {
    mockOnSnapshot.mockReturnValue(() => {});
    useOpponentStore.getState().subscribe(['team-1', 'team-2']);
    expect(mockWhere).toHaveBeenCalledWith('teamId', 'in', ['team-1', 'team-2']);
  });

  it('returns a no-op unsubscribe and sets loading: false when userTeamIds is empty', () => {
    const unsub = useOpponentStore.getState().subscribe([]);
    expect(mockOnSnapshot).not.toHaveBeenCalled();
    expect(useOpponentStore.getState().loading).toBe(false);
    expect(() => unsub()).not.toThrow();
  });

  it('caps the teamId filter at 30 IDs (Firestore in-query limit)', () => {
    mockOnSnapshot.mockReturnValue(() => {});
    const manyIds = Array.from({ length: 35 }, (_, i) => `team-${i}`);
    useOpponentStore.getState().subscribe(manyIds);
    const teamIdCall = mockWhere.mock.calls.find(c => c[0] === 'teamId');
    expect(teamIdCall).toBeDefined();
    expect((teamIdCall![2] as string[]).length).toBe(30);
  });
});

// ── fetchForTeams() ───────────────────────────────────────────────────────────

describe('useOpponentStore — fetchForTeams', () => {
  it('calls getDocs with a teamId "in" filter', async () => {
    mockGetDocs.mockResolvedValue(makeSnapshot([]));
    await useOpponentStore.getState().fetchForTeams(['team-1']);
    expect(mockGetDocs).toHaveBeenCalledOnce();
    expect(mockWhere).toHaveBeenCalledWith('teamId', 'in', ['team-1']);
  });

  it('sets loading: false immediately when teamIds is empty (no fetch)', async () => {
    await useOpponentStore.getState().fetchForTeams([]);
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(useOpponentStore.getState().loading).toBe(false);
  });

  it('populates opponents from the getDocs result', async () => {
    const opponents = [makeOpponent('o1'), makeOpponent('o2')];
    mockGetDocs.mockResolvedValue(makeSnapshot(opponents));
    await useOpponentStore.getState().fetchForTeams(['team-1']);
    expect(useOpponentStore.getState().opponents).toHaveLength(2);
  });

  it('sets loading: false on getDocs error', async () => {
    mockGetDocs.mockRejectedValue(new Error('Permission denied'));
    await useOpponentStore.getState().fetchForTeams(['team-1']);
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
