/**
 * useLeagueStore — action unit tests
 *
 * Behaviors under test:
 *   - subscribe() filters isDeleted leagues out
 *   - addLeague() / updateLeague() write to Firestore
 *   - deleteLeague() calls the deleteLeague Cloud Function via httpsCallable
 *   - Error propagation from Firestore / Cloud Functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { League } from '@/types';
import type { Team } from '@/types';
import type { ScheduledEvent } from '@/types';

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockSetDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockOnSnapshot = vi.fn(() => () => {});
const mockDoc = vi.fn((...args) => ({ _path: args.slice(1).join('/') }));
const mockCollection = vi.fn(() => ({}));
const mockQuery = vi.fn(q => q);
const mockOrderBy = vi.fn(() => ({}));
const mockArrayRemove = vi.fn(v => ({ _remove: v }));
const mockWhere = vi.fn(() => ({}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  arrayRemove: (v: unknown) => mockArrayRemove(v),
}));

vi.mock('@/lib/firebase', () => ({ db: {}, functions: {} }));

// ── Firebase Functions mock ───────────────────────────────────────────────────

const mockDeleteLeagueFn = vi.fn();
const mockHttpsCallable = vi.fn(() => mockDeleteLeagueFn);

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
}));

// ── Dependent store mocks ─────────────────────────────────────────────────────

let mockTeams: Team[] = [];
let mockEvents: ScheduledEvent[] = [];

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

function makeTeam(id: string, leagueIds: string[] = []): Team {
  return {
    id,
    name: `Team ${id}`,
    sportType: 'soccer',
    color: '#000',
    createdBy: 'uid',
    ownerName: 'Coach',
    leagueIds,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as Team;
}

function makeEvent(id: string, teamIds: string[], overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id,
    title: `Event ${id}`,
    type: 'game',
    status: 'scheduled',
    date: '2026-06-01',
    startTime: '10:00',
    teamIds,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as ScheduledEvent;
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
  useLeagueStore.setState({ leagues: [], loading: true });
});

// ── subscribe() ───────────────────────────────────────────────────────────────

describe('useLeagueStore — subscribe', () => {
  it('queries with server-side isDeleted filter and populates leagues from snapshot', () => {
    const active = makeLeague('l1');
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([active]));
      return () => {};
    });

    useLeagueStore.getState().subscribe();

    // Server-side equality filter — only docs with isDeleted == false are returned
    expect(mockWhere).toHaveBeenCalledWith('isDeleted', '==', false);
    const { leagues } = useLeagueStore.getState();
    expect(leagues).toHaveLength(1);
    expect(leagues[0].id).toBe('l1');
  });

  it('sets loading to false after snapshot fires', () => {
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([]));
      return () => {};
    });
    useLeagueStore.getState().subscribe();
    expect(useLeagueStore.getState().loading).toBe(false);
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
