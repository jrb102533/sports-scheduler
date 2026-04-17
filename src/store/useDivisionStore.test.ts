/**
 * useDivisionStore — unit tests
 *
 * Behaviors under test:
 *   - fetchDivisions queries with a where('seasonId') filter and populates store
 *   - fetchDivisions sets loading: false after snapshot, sets error on failure
 *   - createDivision writes to Firestore with generated id + timestamps, returns Division
 *   - updateDivision calls updateDoc with a fresh updatedAt
 *   - addTeamToDivision appends teamId to existing teamIds
 *   - addTeamToDivision is a no-op when teamId is already present
 *   - removeTeamFromDivision removes teamId from teamIds
 *   - removeTeamFromDivision is a no-op when division is not found
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Division } from '@/types';

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockOnSnapshot = vi.fn(() => () => {});
const mockDoc = vi.fn(() => ({}));
const mockCollection = vi.fn(() => ({}));
const mockQuery = vi.fn(q => q);
const mockWhere = vi.fn(() => ({}));
const mockOrderBy = vi.fn(() => ({}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

// ── Import store after mocks ──────────────────────────────────────────────────

import { useDivisionStore } from './useDivisionStore';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeDivision(id: string, overrides: Partial<Division> = {}): Division {
  return {
    id,
    name: `Division ${id}`,
    teamIds: [],
    scheduleStatus: 'none',
    seasonId: 'season-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Division;
}

function makeSnapshot(divisions: Division[]) {
  return { docs: divisions.map(d => ({ id: d.id, data: () => d })) };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
  useDivisionStore.setState({ divisions: [], loading: false, error: null });
});

// ── fetchDivisions() ──────────────────────────────────────────────────────────

describe('useDivisionStore — fetchDivisions', () => {
  it('populates divisions from snapshot', () => {
    const divisions = [makeDivision('d1'), makeDivision('d2')];
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot(divisions));
      return () => {};
    });

    useDivisionStore.getState().fetchDivisions('league-1', 'season-1');
    expect(useDivisionStore.getState().divisions).toHaveLength(2);
    expect(useDivisionStore.getState().divisions[0].id).toBe('d1');
  });

  it('filters by seasonId via where clause', () => {
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([]));
      return () => {};
    });

    useDivisionStore.getState().fetchDivisions('league-1', 'season-99');
    expect(mockWhere).toHaveBeenCalledWith('seasonId', '==', 'season-99');
  });

  it('sets loading: false after snapshot fires', () => {
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([]));
      return () => {};
    });
    useDivisionStore.getState().fetchDivisions('league-1', 'season-1');
    expect(useDivisionStore.getState().loading).toBe(false);
  });

  it('sets loading: false and records error on snapshot error', () => {
    mockOnSnapshot.mockImplementation((_q, _cb, errCb) => {
      errCb(new Error('Firestore unavailable'));
      return () => {};
    });
    useDivisionStore.getState().fetchDivisions('league-1', 'season-1');
    expect(useDivisionStore.getState().loading).toBe(false);
    expect(useDivisionStore.getState().error).toBe('Firestore unavailable');
  });

  it('returns an unsubscribe function', () => {
    const unsub = vi.fn();
    mockOnSnapshot.mockReturnValue(unsub);
    const result = useDivisionStore.getState().fetchDivisions('league-1', 'season-1');
    expect(typeof result).toBe('function');
  });
});

// ── createDivision() ──────────────────────────────────────────────────────────

describe('useDivisionStore — createDivision', () => {
  it('calls setDoc once', async () => {
    await useDivisionStore.getState().createDivision('league-1', 'season-1', {
      name: 'U12',
      teamIds: [],
    });
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('returns a Division with generated id and timestamps', async () => {
    const result = await useDivisionStore.getState().createDivision('league-1', 'season-1', {
      name: 'U10',
      teamIds: [],
    });
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
    expect(typeof result.createdAt).toBe('string');
    expect(typeof result.updatedAt).toBe('string');
  });

  it('writes the correct seasonId and scheduleStatus to Firestore', async () => {
    await useDivisionStore.getState().createDivision('league-1', 'season-42', {
      name: 'Elite',
      teamIds: ['t1'],
    });
    const written = mockSetDoc.mock.calls[0][1] as Division;
    expect(written.seasonId).toBe('season-42');
    expect(written.scheduleStatus).toBe('none');
    expect(written.name).toBe('Elite');
  });

  it('propagates Firestore errors', async () => {
    mockSetDoc.mockRejectedValue(new Error('Write denied'));
    await expect(
      useDivisionStore.getState().createDivision('league-1', 'season-1', { name: 'Bad', teamIds: [] })
    ).rejects.toThrow('Write denied');
  });
});

// ── updateDivision() ──────────────────────────────────────────────────────────

describe('useDivisionStore — updateDivision', () => {
  it('calls updateDoc with the provided fields', async () => {
    await useDivisionStore.getState().updateDivision('league-1', 'd1', { name: 'Renamed' });
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Renamed' })
    );
  });

  it('includes a fresh updatedAt timestamp', async () => {
    await useDivisionStore.getState().updateDivision('league-1', 'd1', { name: 'X' });
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof patch.updatedAt).toBe('string');
    expect((patch.updatedAt as string).length).toBeGreaterThan(0);
  });
});

// ── addTeamToDivision() ───────────────────────────────────────────────────────

describe('useDivisionStore — addTeamToDivision', () => {
  it('appends teamId to the division teamIds list', async () => {
    useDivisionStore.setState({
      divisions: [makeDivision('d1', { teamIds: ['t1'] })],
    });
    await useDivisionStore.getState().addTeamToDivision('league-1', 'd1', 't2');
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.teamIds).toEqual(['t1', 't2']);
  });

  it('is a no-op when teamId is already in the division', async () => {
    useDivisionStore.setState({
      divisions: [makeDivision('d1', { teamIds: ['t1'] })],
    });
    await useDivisionStore.getState().addTeamToDivision('league-1', 'd1', 't1');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('is a no-op when division is not found', async () => {
    useDivisionStore.setState({ divisions: [] });
    await useDivisionStore.getState().addTeamToDivision('league-1', 'nonexistent', 't1');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

// ── removeTeamFromDivision() ──────────────────────────────────────────────────

describe('useDivisionStore — removeTeamFromDivision', () => {
  it('removes the teamId from the division teamIds list', async () => {
    useDivisionStore.setState({
      divisions: [makeDivision('d1', { teamIds: ['t1', 't2', 't3'] })],
    });
    await useDivisionStore.getState().removeTeamFromDivision('league-1', 'd1', 't2');
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.teamIds).toEqual(['t1', 't3']);
  });

  it('is a no-op when division is not found', async () => {
    useDivisionStore.setState({ divisions: [] });
    await useDivisionStore.getState().removeTeamFromDivision('league-1', 'nonexistent', 't1');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});
