/**
 * usePlayerStore — multi-team fan-out subscription
 *
 * Regression guard for the bug where a coach with multiple team memberships
 * (including at least one non-team membership like league_manager) could not
 * see ANY players. Root cause: subscription filtered by activeMembership.teamId,
 * which was undefined when activeContext pointed at an LM membership.
 *
 * The fix: open one onSnapshot listener per teamId the user has ANY membership
 * in, not just the "active" one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type QueryMarker = { _type: 'query'; collection?: string; collectionGroup?: string; teamId?: string };

// Capture each onSnapshot registration's query and callback so tests can
// inspect what listeners were opened and feed synthetic snapshot data in.
const snapshotRegistrations: Array<{ query: QueryMarker; cb: (snap: unknown) => void; unsub: () => void }> = [];

const mockDoc = vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
const mockCollection = vi.fn((_db: unknown, name: string) => ({ _collection: name }));
const mockCollectionGroup = vi.fn((_db: unknown, name: string) => ({ _collectionGroup: name }));
const mockOrderBy = vi.fn((field: string) => ({ _orderBy: field }));
const mockWhere = vi.fn((field: string, op: string, value: unknown) => ({ _where: { field, op, value } }));

type WhereClause = { _where?: { field: string; op: string; value: unknown } };
type CollectionMarker = { _collection?: string; _collectionGroup?: string };

const mockQuery = vi.fn((..._args: unknown[]) => {
  const collectionMarker = _args[0] as CollectionMarker | undefined;
  const teamIdClause = _args.find(
    (a): a is WhereClause => typeof a === 'object' && a !== null && '_where' in a && (a as WhereClause)._where?.field === 'teamId',
  );
  return {
    _type: 'query' as const,
    collection: collectionMarker?._collection,
    collectionGroup: collectionMarker?._collectionGroup,
    teamId: teamIdClause?._where?.value as string | undefined,
  };
});

const mockOnSnapshot = vi.fn((q: QueryMarker, cb: (snap: unknown) => void) => {
  const unsub = vi.fn();
  snapshotRegistrations.push({ query: q, cb, unsub });
  return unsub;
});

vi.mock('firebase/firestore', () => ({
  setDoc: vi.fn().mockResolvedValue(undefined),
  doc: (...args: unknown[]) => mockDoc(...(args as Parameters<typeof mockDoc>)),
  collection: (...args: unknown[]) => mockCollection(...(args as Parameters<typeof mockCollection>)),
  collectionGroup: (...args: unknown[]) => mockCollectionGroup(...(args as Parameters<typeof mockCollectionGroup>)),
  where: (...args: unknown[]) => mockWhere(...(args as Parameters<typeof mockWhere>)),
  orderBy: (...args: unknown[]) => mockOrderBy(...(args as Parameters<typeof mockOrderBy>)),
  query: (...args: unknown[]) => mockQuery(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...(args as Parameters<typeof mockOnSnapshot>)),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  writeBatch: vi.fn(() => ({ delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

type TestProfile = {
  role: string;
  teamId?: string;
  activeContext?: number;
  memberships?: Array<{ role: string; teamId?: string; leagueId?: string; isPrimary?: boolean }>;
} | null;

const mockAuthGetState = vi.fn<() => { profile: TestProfile }>(() => ({ profile: { role: 'coach', teamId: 'team-1' } }));
const authSubscribers: Array<(state: { profile: TestProfile }) => void> = [];

vi.mock('./useAuthStore', () => ({
  useAuthStore: {
    getState: () => mockAuthGetState(),
    subscribe: (listener: (state: { profile: TestProfile }) => void) => {
      authSubscribers.push(listener);
      return () => {
        const i = authSubscribers.indexOf(listener);
        if (i >= 0) authSubscribers.splice(i, 1);
      };
    },
  },
  getMemberships: (profile: TestProfile) => {
    if (!profile) return [];
    if (profile.memberships && profile.memberships.length > 0) return profile.memberships;
    return [{ role: profile.role, teamId: profile.teamId }];
  },
  getActiveMembership: () => null, // not exercised by fan-out logic
}));

import { usePlayerStore } from './usePlayerStore';

/** Filter only the main-players listeners, excluding the sensitiveData ones. */
function playerListeners() {
  return snapshotRegistrations.filter(r => r.query.collection === 'players');
}

function resetStoreState() {
  snapshotRegistrations.length = 0;
  authSubscribers.length = 0;
  usePlayerStore.setState({ players: [], loading: true });
}

describe('usePlayerStore — multi-team fan-out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStoreState();
  });

  it('opens one player listener per teamId in memberships', () => {
    mockAuthGetState.mockReturnValue({
      profile: {
        role: 'coach',
        activeContext: 3, // LM context (no teamId) — the exact bug scenario
        memberships: [
          { role: 'coach', isPrimary: true }, // no teamId
          { role: 'coach', teamId: 'team-A' },
          { role: 'coach', teamId: 'team-B' },
          { role: 'league_manager', leagueId: 'league-X' }, // no teamId
        ],
      },
    });

    const unsub = usePlayerStore.getState().subscribe();

    const teamsSubscribed = playerListeners().map(r => r.query.teamId);
    expect(teamsSubscribed.sort()).toEqual(['team-A', 'team-B']);

    unsub();
  });

  it('merges players across all subscribed teams into a single flat array', () => {
    mockAuthGetState.mockReturnValue({
      profile: {
        role: 'coach',
        memberships: [
          { role: 'coach', teamId: 'team-A' },
          { role: 'coach', teamId: 'team-B' },
        ],
      },
    });

    usePlayerStore.getState().subscribe();

    const listeners = playerListeners();
    expect(listeners.length).toBe(2);

    // Fire a snap for team-A
    const teamA = listeners.find(l => l.query.teamId === 'team-A')!;
    teamA.cb({
      docs: [{ id: 'p1', data: () => ({ teamId: 'team-A', firstName: 'A', lastName: 'One', status: 'active' }) }],
    });

    // Fire a snap for team-B
    const teamB = listeners.find(l => l.query.teamId === 'team-B')!;
    teamB.cb({
      docs: [{ id: 'p2', data: () => ({ teamId: 'team-B', firstName: 'B', lastName: 'Two', status: 'active' }) }],
    });

    const players = usePlayerStore.getState().players;
    expect(players.map(p => p.id).sort()).toEqual(['p1', 'p2']);
  });

  it('tears down listeners for teams removed from memberships', () => {
    mockAuthGetState.mockReturnValue({
      profile: {
        role: 'coach',
        memberships: [
          { role: 'coach', teamId: 'team-A' },
          { role: 'coach', teamId: 'team-B' },
        ],
      },
    });
    usePlayerStore.getState().subscribe();

    const initial = playerListeners();
    const teamAUnsub = initial.find(l => l.query.teamId === 'team-A')!.unsub;
    const teamBUnsub = initial.find(l => l.query.teamId === 'team-B')!.unsub;

    // Drop team-B from memberships, trigger auth listener
    mockAuthGetState.mockReturnValue({
      profile: {
        role: 'coach',
        memberships: [{ role: 'coach', teamId: 'team-A' }],
      },
    });
    for (const listener of authSubscribers) {
      listener({ profile: mockAuthGetState().profile });
    }

    expect(teamAUnsub).not.toHaveBeenCalled();
    expect(teamBUnsub).toHaveBeenCalledTimes(1);
  });

  it('admin role opens a single unfiltered listener, not per-team fan-out', () => {
    mockAuthGetState.mockReturnValue({
      profile: { role: 'admin' },
    });
    usePlayerStore.getState().subscribe();

    // Admin players query uses collection('players') with NO teamId filter.
    const adminPlayerQueries = snapshotRegistrations.filter(
      r => r.query.collection === 'players' && r.query.teamId === undefined,
    );
    expect(adminPlayerQueries.length).toBe(1);
    expect(playerListeners().length).toBe(1);
  });

  it('empty memberships publishes an empty list without opening listeners', () => {
    mockAuthGetState.mockReturnValue({
      profile: { role: 'coach', memberships: [] },
    });
    usePlayerStore.getState().subscribe();

    expect(playerListeners().length).toBe(0);
    expect(usePlayerStore.getState().players).toEqual([]);
    expect(usePlayerStore.getState().loading).toBe(false);
  });
});
