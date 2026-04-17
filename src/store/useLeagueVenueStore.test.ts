/**
 * useLeagueVenueStore — unit tests
 *
 * Behaviors under test:
 *   - subscribe() populates venues from snapshot, filters out deleted venues (deletedAt set)
 *   - subscribe() sorts venues by importedAt ascending
 *   - subscribe() is a no-op when already subscribed to the same leagueId
 *   - subscribe() sets loading: false after snapshot
 *   - importVenue writes to Firestore with generated id + timestamps, preserves source data
 *   - updateLeagueVenue calls setDoc with fresh updatedAt
 *   - removeLeagueVenue calls updateDoc with deletedAt (soft delete only)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LeagueVenue, Venue } from '@/types';

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockOnSnapshot = vi.fn(() => () => {});
const mockDoc = vi.fn(() => ({}));
const mockCollection = vi.fn(() => ({}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

// ── Import store after mocks ──────────────────────────────────────────────────

import { useLeagueVenueStore } from './useLeagueVenueStore';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeVenue(id: string, overrides: Partial<Venue> = {}): Venue {
  return {
    id,
    name: `Venue ${id}`,
    address: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Venue;
}

function makeLeagueVenue(id: string, overrides: Partial<LeagueVenue> = {}): LeagueVenue {
  return {
    id,
    name: `League Venue ${id}`,
    address: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    sourceVenueId: `source-${id}`,
    importedBy: 'lm-uid',
    importedAt: `2026-01-0${id}T00:00:00.000Z`,
    createdAt: `2026-01-0${id}T00:00:00.000Z`,
    updatedAt: `2026-01-0${id}T00:00:00.000Z`,
    ...overrides,
  } as LeagueVenue;
}

function makeSnapshot(venues: LeagueVenue[]) {
  return { docs: venues.map(v => ({ id: v.id, data: () => v })) };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
  useLeagueVenueStore.setState({ venues: [], leagueId: null, loading: true });
});

// ── subscribe() ───────────────────────────────────────────────────────────────

describe('useLeagueVenueStore — subscribe', () => {
  it('populates venues from snapshot', () => {
    const venues = [makeLeagueVenue('1'), makeLeagueVenue('2')];
    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb(makeSnapshot(venues));
      return () => {};
    });

    useLeagueVenueStore.getState().subscribe('league-1');
    expect(useLeagueVenueStore.getState().venues).toHaveLength(2);
  });

  it('filters out soft-deleted venues (deletedAt set)', () => {
    const venues = [
      makeLeagueVenue('1'),
      makeLeagueVenue('2', { deletedAt: '2026-03-01T00:00:00.000Z' }),
    ];
    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb(makeSnapshot(venues));
      return () => {};
    });

    useLeagueVenueStore.getState().subscribe('league-1');
    expect(useLeagueVenueStore.getState().venues).toHaveLength(1);
    expect(useLeagueVenueStore.getState().venues[0].id).toBe('1');
  });

  it('sorts venues by importedAt ascending', () => {
    const venues = [
      makeLeagueVenue('3', { importedAt: '2026-01-03T00:00:00.000Z' }),
      makeLeagueVenue('1', { importedAt: '2026-01-01T00:00:00.000Z' }),
      makeLeagueVenue('2', { importedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb(makeSnapshot(venues));
      return () => {};
    });

    useLeagueVenueStore.getState().subscribe('league-1');
    const ids = useLeagueVenueStore.getState().venues.map(v => v.id);
    expect(ids).toEqual(['1', '2', '3']);
  });

  it('sets loading: false after snapshot fires', () => {
    mockOnSnapshot.mockImplementation((_ref, cb) => {
      cb(makeSnapshot([]));
      return () => {};
    });
    useLeagueVenueStore.getState().subscribe('league-1');
    expect(useLeagueVenueStore.getState().loading).toBe(false);
  });

  it('is a no-op when already subscribed to the same leagueId', () => {
    useLeagueVenueStore.setState({ leagueId: 'league-1', loading: false });
    const unsub = useLeagueVenueStore.getState().subscribe('league-1');
    // Should return a noop unsubscribe without calling onSnapshot
    expect(mockOnSnapshot).not.toHaveBeenCalled();
    expect(typeof unsub).toBe('function');
  });

  it('returns an unsubscribe function', () => {
    const unsub = vi.fn();
    mockOnSnapshot.mockReturnValue(unsub);
    const result = useLeagueVenueStore.getState().subscribe('league-1');
    expect(typeof result).toBe('function');
  });
});

// ── importVenue() ─────────────────────────────────────────────────────────────

describe('useLeagueVenueStore — importVenue', () => {
  it('calls setDoc once', async () => {
    await useLeagueVenueStore.getState().importVenue('league-1', makeVenue('v1'), 'lm-uid');
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('returns a LeagueVenue with generated id and timestamps', async () => {
    const result = await useLeagueVenueStore.getState().importVenue('league-1', makeVenue('v1'), 'lm-uid');
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
    expect(typeof result.importedAt).toBe('string');
    expect(typeof result.createdAt).toBe('string');
  });

  it('preserves the source venue id in sourceVenueId', async () => {
    const source = makeVenue('original-id');
    const result = await useLeagueVenueStore.getState().importVenue('league-1', source, 'lm-uid');
    expect(result.sourceVenueId).toBe('original-id');
  });

  it('sets importedBy to the provided lmUid', async () => {
    const result = await useLeagueVenueStore.getState().importVenue('league-1', makeVenue('v1'), 'league-manager-uid');
    expect(result.importedBy).toBe('league-manager-uid');
  });
});

// ── updateLeagueVenue() ───────────────────────────────────────────────────────

describe('useLeagueVenueStore — updateLeagueVenue', () => {
  it('calls setDoc with the venue data and a fresh updatedAt', async () => {
    const venue = makeLeagueVenue('lv1', { updatedAt: '2020-01-01T00:00:00.000Z' });
    await useLeagueVenueStore.getState().updateLeagueVenue('league-1', venue);
    expect(mockSetDoc).toHaveBeenCalledOnce();
    const written = mockSetDoc.mock.calls[0][1] as LeagueVenue;
    expect(written.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });
});

// ── removeLeagueVenue() ───────────────────────────────────────────────────────

describe('useLeagueVenueStore — removeLeagueVenue (soft delete)', () => {
  it('calls updateDoc (not deleteDoc) with deletedAt timestamp', async () => {
    await useLeagueVenueStore.getState().removeLeagueVenue('league-1', 'lv1');
    expect(mockUpdateDoc).toHaveBeenCalledOnce();
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof patch.deletedAt).toBe('string');
    expect((patch.deletedAt as string).length).toBeGreaterThan(0);
  });

  it('also writes a fresh updatedAt on soft delete', async () => {
    await useLeagueVenueStore.getState().removeLeagueVenue('league-1', 'lv1');
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof patch.updatedAt).toBe('string');
  });
});
