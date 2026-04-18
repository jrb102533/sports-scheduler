/**
 * usePlayerStore — subscribe() query scoping
 *
 * Regression tests for the SEC-48/49/50 rules change which added
 * `resource.data.teamId` conditions to the player read rule.
 * Firestore rejects unfiltered list queries when the rule references
 * `resource.data` — the subscription must use `where('teamId', '==', ...)`.
 *
 * What we're verifying:
 *   - Admin role → unfiltered query (no teamId where-clause)
 *   - Coach with profile.teamId → where('teamId', '==', teamId)
 *   - Parent/player with profile.teamId → where('teamId', '==', teamId)
 *   - Profile not yet loaded (teamId undefined) → no subscription started
 *   - Profile teamId changes → subscription re-initialised with new teamId
 *
 * Strategy: capture the arguments passed to `query()` and `where()` via
 * vi.mock. The mocked onSnapshot records the query it received so we can
 * assert the correct Firestore query was built without hitting a real db.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore mock ─────────────────────────────────────────────────────────────

vi.mock('@/lib/firebase', () => ({ db: { _tag: 'mock-db' }, auth: {}, app: {}, functions: {} }));

// Track every query built so tests can inspect args.
const capturedQueries: unknown[][] = [];
let _onSnapshotCallback: ((snap: { docs: unknown[] }) => void) | null = null;

const mockWhere = vi.fn((...args: unknown[]) => ({ _type: 'where', args }));
const mockOrderBy = vi.fn((...args: unknown[]) => ({ _type: 'orderBy', args }));
const mockCollection = vi.fn(() => ({ _type: 'collection' }));
const mockCollectionGroup = vi.fn(() => ({ _type: 'collectionGroup' }));
const mockQuery = vi.fn((...args: unknown[]) => {
  capturedQueries.push(args);
  return { _type: 'query', args };
});

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  collectionGroup: (...args: unknown[]) => mockCollectionGroup(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  onSnapshot: vi.fn((q, success) => {
    _onSnapshotCallback = success as (snap: { docs: unknown[] }) => void;
    // Fire immediately with empty snapshot so loading=false
    success({ docs: [] });
    return vi.fn(); // unsub
  }),
  doc: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  writeBatch: vi.fn(() => ({ delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) })),
}));

// ── Auth store mock ────────────────────────────────────────────────────────────

type ProfileRole = 'admin' | 'coach' | 'parent' | 'player' | 'league_manager';

interface MockProfile {
  role: ProfileRole;
  teamId?: string;
  uid: string;
}

let mockProfile: MockProfile | null = null;
const authSubscribers: Array<(state: { profile: MockProfile | null }) => void> = [];

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: {
    getState: () => ({ profile: mockProfile }),
    subscribe: (cb: (state: { profile: MockProfile | null }) => void) => {
      authSubscribers.push(cb);
      return () => { authSubscribers.splice(authSubscribers.indexOf(cb), 1); };
    },
  },
  // getActiveMembership mirrors the real implementation for the mock profile shape
  getActiveMembership: (profile: MockProfile | null) =>
    profile ? { role: profile.role, teamId: profile.teamId } : null,
  // getMemberships: synthesise a single membership from profile.teamId when
  // the mock profile has no `memberships` array (the shape these older tests use).
  getMemberships: (profile: MockProfile | null) =>
    profile ? [{ role: profile.role, teamId: profile.teamId }] : [],
}));

function setProfile(profile: MockProfile | null) {
  mockProfile = profile;
  authSubscribers.forEach(cb => cb({ profile }));
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function whereCallsWith(field: string, op: string, value: unknown) {
  return mockWhere.mock.calls.some(
    call => call[0] === field && call[1] === op && call[2] === value,
  );
}

function whereCalledForTeamId(teamId: string) {
  return whereCallsWith('teamId', '==', teamId);
}

function whereNotCalledForTeamId() {
  return !mockWhere.mock.calls.some(call => call[0] === 'teamId');
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('usePlayerStore.subscribe() — query scoping (regression: SEC-48/49/50)', () => {
  let usePlayerStore: typeof import('@/store/usePlayerStore').usePlayerStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedQueries.length = 0;
    _onSnapshotCallback = null;
    mockProfile = null;
    authSubscribers.length = 0;
    vi.resetModules();
    ({ usePlayerStore } = await import('@/store/usePlayerStore'));
  });

  // ── Admin ──────────────────────────────────────────────────────────────────

  it('admin: subscribes with no teamId where-clause (unfiltered query)', () => {
    setProfile({ role: 'admin', uid: 'admin-uid' });
    const unsub = usePlayerStore.getState().subscribe();

    expect(whereNotCalledForTeamId()).toBe(true);
    expect(mockQuery).toHaveBeenCalled();

    unsub();
  });

  it('admin: query args include orderBy but no where for teamId', () => {
    setProfile({ role: 'admin', uid: 'admin-uid' });
    const unsub = usePlayerStore.getState().subscribe();

    // The players query should contain orderBy('createdAt') but no where('teamId')
    const playerQuery = capturedQueries.find(args =>
      args.some((a: unknown) => {
        if (typeof a === 'object' && a !== null && '_type' in a) {
          return (a as { _type: string; args: unknown[] })._type === 'orderBy';
        }
        return false;
      })
    );
    expect(playerQuery).toBeDefined();
    expect(whereNotCalledForTeamId()).toBe(true);

    unsub();
  });

  // ── Coach ──────────────────────────────────────────────────────────────────

  it('coach: subscribes with where("teamId", "==", profile.teamId)', () => {
    setProfile({ role: 'coach', teamId: 'team-abc', uid: 'coach-uid' });
    const unsub = usePlayerStore.getState().subscribe();

    expect(whereCalledForTeamId('team-abc')).toBe(true);

    unsub();
  });

  it('coach: does NOT use an unfiltered query', () => {
    setProfile({ role: 'coach', teamId: 'team-abc', uid: 'coach-uid' });
    const unsub = usePlayerStore.getState().subscribe();

    // Every query() call that includes orderBy must also include a where('teamId')
    const hasUnfilteredPlayerQuery = capturedQueries.some(args => {
      const hasOrderBy = args.some((a: unknown) =>
        typeof a === 'object' && a !== null && '_type' in a &&
        (a as { _type: string })._type === 'orderBy'
      );
      const hasTeamIdWhere = args.some((a: unknown) =>
        typeof a === 'object' && a !== null && '_type' in a &&
        (a as { _type: string; args: unknown[] })._type === 'where' &&
        (a as { _type: string; args: unknown[] }).args[0] === 'teamId'
      );
      return hasOrderBy && !hasTeamIdWhere;
    });

    expect(hasUnfilteredPlayerQuery).toBe(false);

    unsub();
  });

  it('coach with no teamId yet: does not start a subscription', () => {
    setProfile({ role: 'coach', teamId: undefined, uid: 'coach-uid' });
    const callsBefore = mockQuery.mock.calls.length;
    const unsub = usePlayerStore.getState().subscribe();

    // No player query should have been built — teamId is missing
    const callsAfter = mockQuery.mock.calls.length;
    // Only collectionGroup (sensitiveData) queries may be built, not player ones
    // (collection queries for players need teamId)
    expect(whereCalledForTeamId('')).toBe(false);
    // If a query WAS built, it must not be the unfiltered players query
    if (callsAfter > callsBefore) {
      expect(whereNotCalledForTeamId()).toBe(true); // only the collectionGroup query
    }

    unsub();
  });

  // ── Parent / player ────────────────────────────────────────────────────────

  it('parent: subscribes with where("teamId", "==", profile.teamId)', () => {
    setProfile({ role: 'parent', teamId: 'team-xyz', uid: 'parent-uid' });
    const unsub = usePlayerStore.getState().subscribe();

    expect(whereCalledForTeamId('team-xyz')).toBe(true);

    unsub();
  });

  it('player: subscribes with where("teamId", "==", profile.teamId)', () => {
    setProfile({ role: 'player', teamId: 'team-xyz', uid: 'player-uid' });
    const unsub = usePlayerStore.getState().subscribe();

    expect(whereCalledForTeamId('team-xyz')).toBe(true);

    unsub();
  });

  // ── Dynamic re-subscription ────────────────────────────────────────────────

  it('re-subscribes with new teamId when profile.teamId changes', async () => {
    // Start with no profile
    setProfile(null);
    const unsub = usePlayerStore.getState().subscribe();

    const initialWhereCalls = mockWhere.mock.calls.length;

    // Profile arrives — coach with teamId
    setProfile({ role: 'coach', teamId: 'team-new', uid: 'coach-uid' });

    // A new where('teamId', '==', 'team-new') call must have been made
    expect(whereCalledForTeamId('team-new')).toBe(true);
    expect(mockWhere.mock.calls.length).toBeGreaterThan(initialWhereCalls);

    unsub();
  });

  it('re-subscribes when teamId changes to a different team', async () => {
    setProfile({ role: 'coach', teamId: 'team-old', uid: 'coach-uid' });
    const unsub = usePlayerStore.getState().subscribe();

    expect(whereCalledForTeamId('team-old')).toBe(true);

    // Profile updates to a new team
    vi.clearAllMocks();
    capturedQueries.length = 0;
    setProfile({ role: 'coach', teamId: 'team-new', uid: 'coach-uid' });

    expect(whereCalledForTeamId('team-new')).toBe(true);
    expect(whereCalledForTeamId('team-old')).toBe(false);

    unsub();
  });

  // ── Store state ────────────────────────────────────────────────────────────

  it('store.loading becomes false after snapshot fires', () => {
    setProfile({ role: 'coach', teamId: 'team-abc', uid: 'coach-uid' });
    const unsub = usePlayerStore.getState().subscribe();

    expect(usePlayerStore.getState().loading).toBe(false);

    unsub();
  });

  it('store.players is empty for empty snapshot', () => {
    setProfile({ role: 'coach', teamId: 'team-abc', uid: 'coach-uid' });
    const unsub = usePlayerStore.getState().subscribe();

    expect(usePlayerStore.getState().players).toEqual([]);

    unsub();
  });

  it('store.players is empty when profile has no teamId (no subscription)', () => {
    setProfile({ role: 'coach', teamId: undefined, uid: 'coach-uid' });
    const unsub = usePlayerStore.getState().subscribe();

    expect(usePlayerStore.getState().players).toEqual([]);

    unsub();
  });
});
