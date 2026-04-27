/**
 * usePlayerStore — league_manager roster fan-out regression
 *
 * Regresses the bug where an LM creating a team and adding a player saw an
 * empty roster. The pre-fix `extractTeamIds` only looked at profile.teamId /
 * profile.memberships[].teamId. LMs hold leagueId memberships, so the wanted
 * set was always empty and no player listener was ever attached.
 *
 * The fix adds `extractLeagueIds` + derives the LM's wanted team set by
 * intersecting their leagueIds with `useTeamStore.getState().teams[].leagueIds`.
 * It also re-reconciles when `useTeamStore` changes (new team arrives).
 *
 * Pre-fix behavior that these tests would catch:
 *   - subscribe() builds wanted=Set{} → no onSnapshot registered → players=[]
 *   - Adding a team to the team store after subscribe does nothing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Player } from '@/types';
import type { Team } from '@/types';

// ── Mock firebase/firestore ───────────────────────────────────────────────────

const mockOnSnapshot = vi.fn(() => () => {});
const mockCollection = vi.fn();
const mockCollectionGroup = vi.fn();
const mockOrderBy = vi.fn();
const mockQuery = vi.fn((..._args: unknown[]) => ({ _type: 'query' }));
const mockWhere = vi.fn((...args: unknown[]) => ({ _type: 'where', args }));
const mockDoc = vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockDeleteDoc = vi.fn().mockResolvedValue(undefined);
const mockWriteBatch = vi.fn(() => ({
  delete: vi.fn(),
  commit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('firebase/firestore', () => ({
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...(args as Parameters<typeof mockOnSnapshot>)),
  collection: (...args: unknown[]) => mockCollection(...args),
  collectionGroup: (...args: unknown[]) => mockCollectionGroup(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  doc: (...args: unknown[]) => mockDoc(...(args as Parameters<typeof mockDoc>)),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  writeBatch: (...args: unknown[]) => mockWriteBatch(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

// ── Auth store mock ───────────────────────────────────────────────────────────

const mockAuthGetState = vi.fn(() => ({
  profile: {
    role: 'league_manager' as const,
    leagueId: 'league-1',
    memberships: [{ role: 'league_manager' as const, leagueId: 'league-1' }],
  },
}));

// Capture auth subscribers so tests can trigger re-reconcile.
const authSubscribers: Array<(state: ReturnType<typeof mockAuthGetState>) => void> = [];
const mockAuthSubscribe = vi.fn((cb: (state: ReturnType<typeof mockAuthGetState>) => void) => {
  authSubscribers.push(cb);
  return () => {
    const i = authSubscribers.indexOf(cb);
    if (i !== -1) authSubscribers.splice(i, 1);
  };
});

vi.mock('./useAuthStore', () => ({
  useAuthStore: {
    getState: () => mockAuthGetState(),
    subscribe: (cb: (state: ReturnType<typeof mockAuthGetState>) => void) => mockAuthSubscribe(cb),
  },
  getActiveMembership: (profile: { leagueId?: string } | null) =>
    profile ? { leagueId: profile.leagueId } : null,
  getMemberships: (profile: {
    teamId?: string;
    leagueId?: string;
    memberships?: Array<{ role?: string; teamId?: string; leagueId?: string }>;
  } | null) => {
    if (!profile) return [];
    if (profile.memberships && profile.memberships.length > 0) return profile.memberships;
    return [];
  },
}));

// ── Team store mock ───────────────────────────────────────────────────────────
// The store uses useTeamStore.getState() and useTeamStore.subscribe().
// We expose a mutable `mockTeams` array so tests can populate it,
// and teamSubscribers so tests can trigger re-reconcile.

let mockTeams: Team[] = [];
const teamSubscribers: Array<() => void> = [];
const mockTeamSubscribe = vi.fn((cb: () => void) => {
  teamSubscribers.push(cb);
  return () => {
    const i = teamSubscribers.indexOf(cb);
    if (i !== -1) teamSubscribers.splice(i, 1);
  };
});

vi.mock('./useTeamStore', () => ({
  useTeamStore: {
    getState: () => ({ teams: mockTeams }),
    subscribe: (cb: () => void) => mockTeamSubscribe(cb),
  },
}));

// ── Import store AFTER mocks ──────────────────────────────────────────────────

import { usePlayerStore } from './usePlayerStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlayer(id: string, teamId: string): Player {
  return {
    id,
    teamId,
    firstName: 'Sam',
    lastName: 'Jones',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeTeam(id: string, leagueIds: string[]): Team {
  return {
    id,
    name: `Team ${id}`,
    sportType: 'soccer',
    leagueIds,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as Team;
}

/**
 * Fire all captured onSnapshot callbacks that match a given call index.
 * Returns the array of captured callbacks so callers can fire individual ones.
 */
function captureSnapshots(duringFn: () => void): Array<(snap: unknown) => void> {
  const cbs: Array<(snap: unknown) => void> = [];
  mockOnSnapshot.mockImplementation((_q: unknown, cb: (snap: unknown) => void) => {
    cbs.push(cb);
    return () => {};
  });
  duringFn();
  return cbs;
}

function makeSnap(players: Player[]) {
  return {
    docs: players.map(p => ({ id: p.id, data: () => ({ ...p }) })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('usePlayerStore — league_manager roster fan-out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTeams = [];
    authSubscribers.length = 0;
    teamSubscribers.length = 0;
    mockAuthGetState.mockReturnValue({
      profile: {
        role: 'league_manager' as const,
        leagueId: 'league-1',
        memberships: [{ role: 'league_manager' as const, leagueId: 'league-1' }],
      },
    });
    usePlayerStore.setState({ players: [], loading: true });
  });

  it('attaches a player listener for a team whose leagueIds intersects the LM leagueId', () => {
    // Arrange: team store already has a team in the LM's league.
    const team = makeTeam('team-lm-1', ['league-1']);
    mockTeams = [team];

    // Act: subscribe — the store should derive team-lm-1 from leagueIds intersection.
    const cbs = captureSnapshots(() => usePlayerStore.getState().subscribe());

    // At least one onSnapshot listener should have been registered.
    // Pre-fix: wanted=Set{} → mockOnSnapshot was never called → cbs is empty.
    expect(cbs.length).toBeGreaterThan(0);
  });

  it('includes players from the intersected team after the snapshot fires', () => {
    // Arrange
    const team = makeTeam('team-lm-1', ['league-1']);
    mockTeams = [team];
    const player = makePlayer('player-lm-1', 'team-lm-1');

    const cbs = captureSnapshots(() => usePlayerStore.getState().subscribe());

    // Act: fire the first (player) snapshot for team-lm-1.
    cbs[0](makeSnap([player]));

    // Assert: player is visible to the LM.
    // Pre-fix: cbs was empty so this snapshot never fired → players=[].
    const found = usePlayerStore.getState().players.find(p => p.id === 'player-lm-1');
    expect(found).toBeDefined();
    expect(found?.teamId).toBe('team-lm-1');
  });

  it('does NOT attach listeners for teams outside the LM leagueIds', () => {
    // Arrange: two teams — one in the LM's league, one in a different league.
    const ownTeam = makeTeam('team-lm-owned', ['league-1']);
    const foreignTeam = makeTeam('team-other-league', ['league-99']);
    mockTeams = [ownTeam, foreignTeam];

    const cbs = captureSnapshots(() => usePlayerStore.getState().subscribe());

    // Each team gets one player listener + one sensitive listener → 2 per team.
    // Pre-fix would have 0 total. Post-fix should have exactly 2 (only ownTeam).
    expect(cbs.length).toBe(2);
  });

  it('picks up players from a team added to the team store after subscribe', () => {
    // Arrange: subscribe with NO teams in the store yet.
    const cbs: Array<(snap: unknown) => void> = [];
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (snap: unknown) => void) => {
      cbs.push(cb);
      return () => {};
    });
    usePlayerStore.getState().subscribe();

    // No teams → no listeners yet.
    expect(cbs.length).toBe(0);

    // Act: a new team arrives in the team store for the LM's league.
    mockTeams = [makeTeam('team-late', ['league-1'])];
    // Trigger the team-store subscriber that reconcile registered.
    teamSubscribers.forEach(cb => cb());

    // Assert: a new snapshot listener was registered after reconcile.
    // Pre-fix: useTeamStore.subscribe was never called → teamSubscribers is empty.
    expect(cbs.length).toBeGreaterThan(0);

    // And firing it populates players.
    const player = makePlayer('player-late', 'team-late');
    cbs[0](makeSnap([player]));
    const found = usePlayerStore.getState().players.find(p => p.id === 'player-late');
    expect(found).toBeDefined();
  });

  it('returns empty players for a coach with no teamId (unrelated role — control path)', () => {
    // Control: ensure the LM-specific path doesn't incorrectly fan out for coaches.
    mockAuthGetState.mockReturnValue({
      profile: {
        role: 'coach' as const,
        teamId: undefined,
        memberships: [],
      },
    });
    mockTeams = [makeTeam('team-lm-1', ['league-1'])];

    mockOnSnapshot.mockImplementation(() => () => {});
    usePlayerStore.getState().subscribe();

    expect(usePlayerStore.getState().players).toEqual([]);
  });
});
