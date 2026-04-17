/**
 * useSeasonStore — unit tests
 *
 * Behaviors under test:
 *   - fetchSeasons subscribes to snapshot and populates seasons, sets loading: false
 *   - fetchSeasons sets error message on snapshot error
 *   - fetchSeasons returns an unsubscribe function
 *   - createSeason writes to Firestore with generated id and timestamps, returns Season
 *   - setActiveSeason updates activeSeason state directly
 *   - archiveSeason writes status: 'archived' to Firestore
 *   - archiveSeason is a no-op when seasonId is not found in store
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Season } from '@/types';

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockSetDoc = vi.fn();
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
  query: (...args: unknown[]) => mockQuery(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

// ── Import store after mocks ──────────────────────────────────────────────────

import { useSeasonStore } from './useSeasonStore';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeSeason(id: string, overrides: Partial<Season> = {}): Season {
  return {
    id,
    name: `Season ${id}`,
    leagueId: 'league-1',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Season;
}

function makeSnapshot(seasons: Season[]) {
  return { docs: seasons.map(s => ({ id: s.id, data: () => s })) };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  useSeasonStore.setState({ seasons: [], activeSeason: null, loading: false, error: null });
});

// ── fetchSeasons() ────────────────────────────────────────────────────────────

describe('useSeasonStore — fetchSeasons', () => {
  it('populates seasons from snapshot', () => {
    const seasons = [makeSeason('s1'), makeSeason('s2')];
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot(seasons));
      return () => {};
    });

    useSeasonStore.getState().fetchSeasons('league-1');
    expect(useSeasonStore.getState().seasons).toHaveLength(2);
    expect(useSeasonStore.getState().seasons[0].id).toBe('s1');
  });

  it('sets loading: false after snapshot fires', () => {
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([]));
      return () => {};
    });
    useSeasonStore.getState().fetchSeasons('league-1');
    expect(useSeasonStore.getState().loading).toBe(false);
  });

  it('sets loading: false and records error message on snapshot error', () => {
    mockOnSnapshot.mockImplementation((_q, _cb, errCb) => {
      errCb(new Error('Permission denied'));
      return () => {};
    });
    useSeasonStore.getState().fetchSeasons('league-1');
    expect(useSeasonStore.getState().loading).toBe(false);
    expect(useSeasonStore.getState().error).toBe('Permission denied');
  });

  it('returns an unsubscribe function', () => {
    const unsub = vi.fn();
    mockOnSnapshot.mockReturnValue(unsub);
    const result = useSeasonStore.getState().fetchSeasons('league-1');
    expect(typeof result).toBe('function');
  });

  it('sets loading: true before snapshot fires', () => {
    // onSnapshot is async in real Firestore — verify loading is set synchronously
    mockOnSnapshot.mockImplementation(() => () => {});
    useSeasonStore.getState().fetchSeasons('league-1');
    expect(useSeasonStore.getState().loading).toBe(true);
  });
});

// ── createSeason() ────────────────────────────────────────────────────────────

describe('useSeasonStore — createSeason', () => {
  it('calls setDoc once', async () => {
    const data = {
      name: 'Fall 2026',
      leagueId: 'league-1',
      status: 'active' as const,
      startDate: '2026-09-01',
      endDate: '2026-11-30',
    };
    await useSeasonStore.getState().createSeason('league-1', data);
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('returns a Season with a generated id and timestamps', async () => {
    const data = {
      name: 'Spring 2026',
      leagueId: 'league-1',
      status: 'active' as const,
      startDate: '2026-03-01',
      endDate: '2026-05-31',
    };
    const result = await useSeasonStore.getState().createSeason('league-1', data);
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
    expect(typeof result.createdAt).toBe('string');
    expect(typeof result.updatedAt).toBe('string');
  });

  it('writes the provided season data to Firestore', async () => {
    const data = {
      name: 'Winter Cup',
      leagueId: 'league-1',
      status: 'active' as const,
      startDate: '2026-01-01',
      endDate: '2026-02-28',
    };
    await useSeasonStore.getState().createSeason('league-1', data);
    const written = mockSetDoc.mock.calls[0][1] as Season;
    expect(written.name).toBe('Winter Cup');
    expect(written.status).toBe('active');
  });

  it('propagates Firestore errors', async () => {
    mockSetDoc.mockRejectedValue(new Error('Write failed'));
    await expect(
      useSeasonStore.getState().createSeason('league-1', {
        name: 'Bad Season',
        leagueId: 'league-1',
        status: 'active' as const,
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      })
    ).rejects.toThrow('Write failed');
  });
});

// ── setActiveSeason() ─────────────────────────────────────────────────────────

describe('useSeasonStore — setActiveSeason', () => {
  it('sets activeSeason to the provided season', () => {
    const season = makeSeason('s1');
    useSeasonStore.getState().setActiveSeason(season);
    expect(useSeasonStore.getState().activeSeason?.id).toBe('s1');
  });

  it('sets activeSeason to null', () => {
    useSeasonStore.setState({ activeSeason: makeSeason('s1') });
    useSeasonStore.getState().setActiveSeason(null);
    expect(useSeasonStore.getState().activeSeason).toBeNull();
  });
});

// ── archiveSeason() ───────────────────────────────────────────────────────────

describe('useSeasonStore — archiveSeason', () => {
  it('calls setDoc with status: archived', async () => {
    useSeasonStore.setState({ seasons: [makeSeason('s1')] });
    await useSeasonStore.getState().archiveSeason('league-1', 's1');
    const written = mockSetDoc.mock.calls[0][1] as Season;
    expect(written.status).toBe('archived');
  });

  it('writes a fresh updatedAt timestamp on archive', async () => {
    useSeasonStore.setState({ seasons: [makeSeason('s1', { updatedAt: '2020-01-01T00:00:00.000Z' })] });
    await useSeasonStore.getState().archiveSeason('league-1', 's1');
    const written = mockSetDoc.mock.calls[0][1] as Season;
    expect(written.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('is a no-op when the seasonId is not in store', async () => {
    useSeasonStore.setState({ seasons: [] });
    await useSeasonStore.getState().archiveSeason('league-1', 'nonexistent');
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});
