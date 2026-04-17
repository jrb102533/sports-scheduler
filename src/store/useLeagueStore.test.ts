/**
 * useLeagueStore — action unit tests
 *
 * Behaviors under test:
 *   - subscribe() filters isDeleted leagues out
 *   - addLeague() / updateLeague() write to Firestore
 *   - deleteLeague() calls deleteDoc
 *   - softDeleteLeague() removes leagueId from affected teams, deletes exclusive
 *     league events, then marks the league as deleted
 *   - Error propagation from Firestore
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

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  arrayRemove: (v: unknown) => mockArrayRemove(v),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

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
  mockTeams = [];
  mockEvents = [];
  useLeagueStore.setState({ leagues: [], loading: true });
});

// ── subscribe() ───────────────────────────────────────────────────────────────

describe('useLeagueStore — subscribe', () => {
  it('populates leagues from snapshot, excluding soft-deleted ones', () => {
    const active = makeLeague('l1');
    const deleted = makeLeague('l2', { isDeleted: true });
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshot([active, deleted]));
      return () => {};
    });

    useLeagueStore.getState().subscribe();
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
  it('calls deleteDoc once', async () => {
    await useLeagueStore.getState().deleteLeague('l1');
    expect(mockDeleteDoc).toHaveBeenCalledOnce();
  });

  it('propagates Firestore errors', async () => {
    mockDeleteDoc.mockRejectedValue(new Error('Not found'));
    await expect(useLeagueStore.getState().deleteLeague('l1')).rejects.toThrow('Not found');
  });
});

// ── softDeleteLeague() ────────────────────────────────────────────────────────

describe('useLeagueStore — softDeleteLeague', () => {
  it('removes the leagueId from associated teams using arrayRemove', async () => {
    mockTeams = [
      makeTeam('t1', ['league-A']),
      makeTeam('t2', ['league-A', 'league-B']),
      makeTeam('t3', ['league-B']), // not in league-A
    ];
    mockEvents = [];

    await useLeagueStore.getState().softDeleteLeague('league-A');

    // updateDoc should be called for t1 and t2 (both in league-A), but not t3
    const teamUpdateCalls = mockUpdateDoc.mock.calls.filter(c =>
      JSON.stringify(c[1]).includes('_remove')
    );
    expect(teamUpdateCalls).toHaveLength(2);
  });

  it('deletes events whose all teams were exclusively in the deleted league', async () => {
    mockTeams = [makeTeam('t1', ['league-A']), makeTeam('t2', ['league-A'])];
    mockEvents = [
      makeEvent('e1', ['t1', 't2']), // exclusively league-A teams
      makeEvent('e2', ['t1', 't3']), // t3 not in league-A
    ];

    await useLeagueStore.getState().softDeleteLeague('league-A');

    // deleteDoc should be called for e1 only
    expect(mockDeleteDoc).toHaveBeenCalledOnce();
    const deletedPath = JSON.stringify(mockDeleteDoc.mock.calls[0][0]);
    expect(deletedPath).toContain('e1');
  });

  it('marks the league document as deleted', async () => {
    mockTeams = [];
    mockEvents = [];

    await useLeagueStore.getState().softDeleteLeague('league-Z');

    // The last updateDoc call should set isDeleted: true
    const leagueUpdateCall = mockUpdateDoc.mock.calls.find(c =>
      (c[1] as Record<string, unknown>).isDeleted === true
    );
    expect(leagueUpdateCall).toBeDefined();
    const patch = leagueUpdateCall![1] as Record<string, unknown>;
    expect(patch.isDeleted).toBe(true);
    expect(typeof patch.deletedAt).toBe('string');
  });

  it('does not delete events that span teams outside the deleted league', async () => {
    mockTeams = [makeTeam('t1', ['league-A'])];
    mockEvents = [
      makeEvent('e1', ['t1', 't2']), // t2 is not in league-A (not in mockTeams at all)
    ];

    await useLeagueStore.getState().softDeleteLeague('league-A');

    // e1 has t2 which is outside league-A — must NOT be deleted
    const deleteCalls = mockDeleteDoc.mock.calls;
    expect(deleteCalls).toHaveLength(0);
  });
});
