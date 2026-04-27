/**
 * useLeagueStore — action unit tests
 *
 * Behaviors under test:
 *   - subscribe(userLeagueIds) — admin/LM use unscoped query, others use
 *     scoped documentId() in query, empty userLeagueIds for non-admin returns
 *     empty leagues + no listener
 *   - subscribe() filters isDeleted leagues out
 *   - addLeague() / updateLeague() write to Firestore
 *   - deleteLeague() calls the deleteLeague Cloud Function via httpsCallable
 *   - Error propagation from Firestore / Cloud Functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { League, Team, ScheduledEvent } from '../types';

type AnyFn = (...args: any[]) => any;

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockSetDoc = vi.fn<AnyFn>();
const mockDeleteDoc = vi.fn<AnyFn>();
const mockUpdateDoc = vi.fn<AnyFn>();
const mockOnSnapshot = vi.fn<AnyFn>();
const mockDoc = vi.fn<AnyFn>((...args) => ({ _path: args.slice(1).join('/') }));
const mockCollection = vi.fn<AnyFn>(() => ({}));
const mockQuery = vi.fn<AnyFn>(q => q);
const mockOrderBy = vi.fn<AnyFn>(() => ({}));
const mockArrayRemove = vi.fn<AnyFn>(v => ({ _remove: v }));
const mockWhere = vi.fn<AnyFn>(() => ({}));
const mockDocumentId = vi.fn<AnyFn>(() => '__id__');

vi.mock('firebase/firestore', () => ({
  collection: (...args: any[]) => mockCollection(...args),
  onSnapshot: (...args: any[]) => mockOnSnapshot(...args),
  doc: (...args: any[]) => mockDoc(...args),
  setDoc: (...args: any[]) => mockSetDoc(...args),
  deleteDoc: (...args: any[]) => mockDeleteDoc(...args),
  updateDoc: (...args: any[]) => mockUpdateDoc(...args),
  query: (...args: any[]) => mockQuery(...args),
  orderBy: (...args: any[]) => mockOrderBy(...args),
  where: (...args: any[]) => mockWhere(...args),
  documentId: () => mockDocumentId(),
  arrayRemove: (v: any) => mockArrayRemove(v),
}));

vi.mock('@/lib/firebase', () => ({ db: {}, functions: {} }));

// ── Firebase Functions mock ───────────────────────────────────────────────────

const mockDeleteLeagueFn = vi.fn<AnyFn>();
const mockHttpsCallable = vi.fn<AnyFn>(() => mockDeleteLeagueFn);

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: any[]) => mockHttpsCallable(...args),
}));

// ── Dependent store mocks ─────────────────────────────────────────────────────

let mockTeams: Team[] = [];
let mockEvents: ScheduledEvent[] = [];
let mockProfile: { role: string } | null = { role: 'admin' };

vi.mock('@/store/useTeamStore', () => ({
  useTeamStore: {
    getState: () => ({ teams: mockTeams }),
  },
}));

vi.mock('@/store/useEventStore', () => ({
  useEventStore: {
    getState: () => ({ events: mockEvents }),
  },
}));

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: {
    getState: () => ({ profile: mockProfile }),
  },
}));

// ── Import store after mocks ──────────────────────────────────────────────────

import { useLeagueStore } from './useLeagueStore';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeLeague(id: string, overrides: Partial<League> = {}): League {
  return {
    id,
    name: `League ${id}`,
    sportType: 'soccer',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as League;
}

function makeSnapshot(leagues: League[]) {
  return { docs: leagues.map(l => ({ id: l.id, data: () => l })) };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  mockDeleteDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
  mockDeleteLeagueFn.mockResolvedValue({ data: { success: true } });
  mockTeams = [];
  mockEvents = [];
  mockProfile = { role: 'admin' };
  useLeagueStore.setState({ leagues: [], loading: true });
});

// ── subscribe() — admin / league_manager (unscoped) ──────────────────────────

describe('useLeagueStore — subscribe (admin)', () => {
  it('queries with server-side isDeleted filter and populates leagues from snapshot', () => {
    mockProfile = { role: 'admin' };
    const active = makeLeague('l1');
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([active]));
      return () => {};
    });

    useLeagueStore.getState().subscribe([]);

    // Server-side equality filter — only docs with isDeleted == false are returned
    expect(mockWhere).toHaveBeenCalledWith('isDeleted', '==', false);
    const { leagues } = useLeagueStore.getState();
    expect(leagues).toHaveLength(1);
    expect(leagues[0].id).toBe('l1');
  });

  it('sets loading to false after snapshot fires', () => {
    mockProfile = { role: 'admin' };
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([]));
      return () => {};
    });
    useLeagueStore.getState().subscribe([]);
    expect(useLeagueStore.getState().loading).toBe(false);
  });

  it('uses unscoped query for league_manager (no documentId IN filter)', () => {
    mockProfile = { role: 'league_manager' };
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([]));
      return () => {};
    });
    useLeagueStore.getState().subscribe([]);

    // Admin/LM path uses isDeleted filter, never the documentId IN filter
    const whereCalls = mockWhere.mock.calls;
    expect(whereCalls.some((c: any[]) => c[0] === 'isDeleted')).toBe(true);
    expect(whereCalls.some((c: any[]) => c[0] === '__id__')).toBe(false);
  });
});

// ── subscribe() — non-admin scoping ──────────────────────────────────────────

describe('useLeagueStore — subscribe (non-admin)', () => {
  it('returns empty + no-op unsub when non-admin has no league memberships', () => {
    mockProfile = { role: 'coach' };
    const unsub = useLeagueStore.getState().subscribe([]);
    expect(mockOnSnapshot).not.toHaveBeenCalled();
    expect(useLeagueStore.getState().leagues).toEqual([]);
    expect(useLeagueStore.getState().loading).toBe(false);
    expect(() => unsub()).not.toThrow();
  });

  it('uses documentId() in query scoped to userLeagueIds', () => {
    mockProfile = { role: 'coach' };
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([makeLeague('l1'), makeLeague('l2')]));
      return () => {};
    });

    useLeagueStore.getState().subscribe(['l1', 'l2']);

    expect(mockWhere).toHaveBeenCalledWith('__id__', 'in', ['l1', 'l2']);
    expect(useLeagueStore.getState().leagues).toHaveLength(2);
  });

  it('caps the documentId IN list at 30 (Firestore limit)', () => {
    mockProfile = { role: 'parent' };
    const lots = Array.from({ length: 50 }, (_, i) => `l${i}`);
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([]));
      return () => {};
    });
    useLeagueStore.getState().subscribe(lots);

    const inCall = mockWhere.mock.calls.find((c: any[]) => c[0] === '__id__');
    expect(inCall).toBeDefined();
    expect((inCall as any[])[2]).toHaveLength(30);
  });

  it('still filters out client-side soft-deleted leagues for non-admin', () => {
    mockProfile = { role: 'coach' };
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([makeLeague('l1'), makeLeague('l2', { isDeleted: true })]));
      return () => {};
    });
    useLeagueStore.getState().subscribe(['l1', 'l2']);
    const { leagues } = useLeagueStore.getState();
    expect(leagues).toHaveLength(1);
    expect(leagues[0].id).toBe('l1');
  });
});

// ── addLeague() ───────────────────────────────────────────────────────────────

describe('useLeagueStore — addLeague', () => {
  it('calls setDoc once', async () => {
    await useLeagueStore.getState().addLeague(makeLeague('l1'));
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('propagates Firestore errors', async () => {
    mockSetDoc.mockRejectedValue(new Error('Write failed'));
    await expect(useLeagueStore.getState().addLeague(makeLeague('l1'))).rejects.toThrow('Write failed');
  });
});

// ── updateLeague() ────────────────────────────────────────────────────────────

describe('useLeagueStore — updateLeague', () => {
  it('calls setDoc with the updated league', async () => {
    const league = makeLeague('l1', { name: 'Renamed League' });
    await useLeagueStore.getState().updateLeague(league);
    expect(mockSetDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'Renamed League' }));
  });
});

// ── deleteLeague() ────────────────────────────────────────────────────────────

describe('useLeagueStore — deleteLeague', () => {
  it('calls the deleteLeague Cloud Function with the leagueId', async () => {
    await useLeagueStore.getState().deleteLeague('league-A');
    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'deleteLeague');
    expect(mockDeleteLeagueFn).toHaveBeenCalledWith({ leagueId: 'league-A' });
  });

  it('propagates Cloud Function errors', async () => {
    mockDeleteLeagueFn.mockRejectedValue(new Error('Permission denied'));
    await expect(useLeagueStore.getState().deleteLeague('league-A')).rejects.toThrow('Permission denied');
  });
});
