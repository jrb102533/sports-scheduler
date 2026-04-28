/**
 * useTeamStore — action unit tests
 *
 * Tests the Zustand store actions that write to Firestore.
 * Firestore is mocked at the module boundary so no emulator is needed.
 *
 * Behaviors under test:
 *   - subscribe() uses documentId() "in" filter for non-admin users
 *   - subscribe() uses isDeleted != true filter for admin users
 *   - subscribe() returns immediately (no listener) when non-admin has no teams
 *   - subscribe() populates teams from snapshot
 *   - subscribe() opens a deleted-teams listener only for admin users
 *   - subscribe() re-opens listener when profile.role arrives after null (race fix)
 *   - subscribe() re-opens listener when profile.memberships change (coach gains a team)
 *   - subscribe() never issues where(documentId(), 'in', []) (empty in-query guard)
 *   - updateTeam() writes to the correct Firestore path
 *   - addTeamToLeague() uses arrayUnion and sets _managedLeagueId
 *   - removeTeamFromLeague() uses arrayRemove and sets _managedLeagueId
 *   - softDeleteTeam() sets isDeleted: true and deletedAt
 *   - restoreTeam() sets isDeleted: false and deletedAt: null
 *   - hardDeleteTeam() calls the hardDeleteTeam Cloud Function callable (not deleteDoc)
 *   - Actions throw when Firestore call fails (state unchanged)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Team } from '@/types';

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockOnSnapshot = vi.fn(() => () => {});
const mockDoc = vi.fn((...args) => ({ _path: args.slice(1).join('/') }));
const mockCollection = vi.fn(() => ({ _coll: true }));
const mockQuery = vi.fn(q => q);
const mockOrderBy = vi.fn(() => ({ _orderBy: true }));
const mockWhere = vi.fn((field, op, value) => ({ _where: { field, op, value } }));
const mockArrayUnion = vi.fn(v => ({ _union: v }));
const mockArrayRemove = vi.fn(v => ({ _remove: v }));
const mockDocumentId = vi.fn(() => '__id__');

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  arrayUnion: (v: unknown) => mockArrayUnion(v),
  arrayRemove: (v: unknown) => mockArrayRemove(v),
  documentId: () => mockDocumentId(),
}));

const mockHttpsCallableFn = vi.fn().mockResolvedValue({ data: { success: true } });
const mockHttpsCallable = vi.fn(() => mockHttpsCallableFn);

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {}, functions: {} }));

// ── Auth store mock ───────────────────────────────────────────────────────────

const mockGetAuthState = vi.fn(() => ({ profile: null }));

// Listeners registered via useAuthStore.subscribe(listener)
type AuthListener = (state: { profile: ReturnType<typeof mockGetAuthState>['profile'] }) => void;
let _authListeners: AuthListener[] = [];
const mockAuthSubscribe = vi.fn((listener: AuthListener) => {
  _authListeners.push(listener);
  return () => { _authListeners = _authListeners.filter(l => l !== listener); };
});

/** Simulate auth state change (profile arrives / changes). */
function simulateAuthChange(profile: { role?: string; memberships?: { role: string; teamId?: string }[] } | null) {
  mockGetAuthState.mockReturnValue({ profile });
  _authListeners.forEach(l => l({ profile } as Parameters<AuthListener>[0]));
}

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: {
    getState: (...args: unknown[]) => mockGetAuthState(...args),
    subscribe: (...args: unknown[]) => mockAuthSubscribe(...(args as [AuthListener])),
  },
}));

// ── Import store after mocks ──────────────────────────────────────────────────

import { useTeamStore } from './useTeamStore';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeTeam(id: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    name: `Team ${id}`,
    sportType: 'soccer',
    color: '#ef4444',
    createdBy: 'coach-uid',
    ownerName: 'Test Coach',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as Team;
}

function makeSnapshotDocs(teams: Team[]) {
  return {
    docs: teams.map(t => ({ id: t.id, data: () => t })),
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  _authListeners = [];
  mockSetDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
  mockDeleteDoc.mockResolvedValue(undefined);
  mockHttpsCallableFn.mockResolvedValue({ data: { success: true } });
  mockOnSnapshot.mockReturnValue(() => {});
  mockGetAuthState.mockReturnValue({ profile: null });
  // Re-wire subscribe mock after clearAllMocks
  mockAuthSubscribe.mockImplementation((listener: AuthListener) => {
    _authListeners.push(listener);
    return () => { _authListeners = _authListeners.filter(l => l !== listener); };
  });
  useTeamStore.setState({ teams: [], deletedTeams: [], loading: true });
});

// ── subscribe() — admin ───────────────────────────────────────────────────────

describe('useTeamStore — subscribe (admin)', () => {
  beforeEach(() => {
    mockGetAuthState.mockReturnValue({ profile: { role: 'admin' } });
  });

  it('applies server-side where clause for isDeleted != true', () => {
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshotDocs([]));
      return () => {};
    });

    useTeamStore.getState().subscribe([]);

    expect(mockWhere).toHaveBeenCalledWith('isDeleted', '!=', true);
  });

  it('maps all snapshot docs to teams (server already excludes deleted)', () => {
    const t1 = makeTeam('t1');
    const t2 = makeTeam('t2');

    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshotDocs([t1, t2]));
      return () => {};
    });

    useTeamStore.getState().subscribe([]);

    const { teams } = useTeamStore.getState();
    expect(teams).toHaveLength(2);
    expect(teams.map(t => t.id)).toEqual(['t1', 't2']);
  });

  it('sets loading to false after snapshot fires', () => {
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshotDocs([]));
      return () => {};
    });

    useTeamStore.getState().subscribe([]);
    expect(useTeamStore.getState().loading).toBe(false);
  });

  it('returns an unsubscribe function', () => {
    const mockUnsub = vi.fn();
    mockOnSnapshot.mockReturnValue(mockUnsub);
    const unsub = useTeamStore.getState().subscribe([]);
    expect(typeof unsub).toBe('function');
  });

  it('sets loading to false on snapshot error', () => {
    mockOnSnapshot.mockImplementation((_q, _cb, errCb) => {
      errCb(new Error('Permission denied'));
      return () => {};
    });

    useTeamStore.getState().subscribe([]);
    expect(useTeamStore.getState().loading).toBe(false);
  });

  it('opens a second snapshot listener for admin users', () => {
    useTeamStore.getState().subscribe([]);

    expect(mockOnSnapshot).toHaveBeenCalledTimes(2);
    expect(mockWhere).toHaveBeenCalledWith('isDeleted', '!=', true);
    expect(mockWhere).toHaveBeenCalledWith('isDeleted', '==', true);
  });

  it('populates deletedTeams from the admin-scoped snapshot', () => {
    const deleted1 = makeTeam('d1', { isDeleted: true, deletedAt: '2024-06-01T00:00:00.000Z' } as Partial<Team>);
    const deleted2 = makeTeam('d2', { isDeleted: true, deletedAt: '2024-05-01T00:00:00.000Z' } as Partial<Team>);

    // First call → main listener (active teams), second call → deleted teams listener
    mockOnSnapshot
      .mockImplementationOnce((_q, cb) => { cb(makeSnapshotDocs([])); return () => {}; })
      .mockImplementationOnce((_q, cb) => { cb(makeSnapshotDocs([deleted1, deleted2])); return () => {}; });

    useTeamStore.getState().subscribe([]);

    const { deletedTeams } = useTeamStore.getState();
    expect(deletedTeams).toHaveLength(2);
    expect(deletedTeams.map(t => t.id)).toEqual(['d1', 'd2']);
  });

  it('tears down both listeners when unsubscribe is called for admin', () => {
    const unsubMain = vi.fn();
    const unsubDeleted = vi.fn();

    mockOnSnapshot
      .mockImplementationOnce(() => unsubMain)
      .mockImplementationOnce(() => unsubDeleted);

    const unsub = useTeamStore.getState().subscribe([]);
    unsub();

    expect(unsubMain).toHaveBeenCalledOnce();
    expect(unsubDeleted).toHaveBeenCalledOnce();
  });
});

// ── subscribe() — league_manager (same bypass as admin) ──────────────────────

describe('useTeamStore — subscribe (league_manager)', () => {
  beforeEach(() => {
    mockGetAuthState.mockReturnValue({ profile: { role: 'league_manager' } });
  });

  it('uses unscoped query (no documentId filter) for league_manager', () => {
    mockOnSnapshot.mockReturnValue(() => {});
    useTeamStore.getState().subscribe([]);
    expect(mockWhere).toHaveBeenCalledWith('isDeleted', '!=', true);
    expect(mockDocumentId).not.toHaveBeenCalled();
  });

  it('opens a listener even when userTeamIds is empty', () => {
    mockOnSnapshot.mockReturnValue(() => {});
    useTeamStore.getState().subscribe([]);
    expect(mockOnSnapshot).toHaveBeenCalled();
  });
});

// ── subscribe() — non-admin scoping ──────────────────────────────────────────

describe('useTeamStore — subscribe (non-admin scoping)', () => {
  beforeEach(() => {
    mockGetAuthState.mockReturnValue({ profile: { role: 'coach' } });
  });

  it('uses documentId() "in" filter scoped to the provided team IDs', () => {
    useTeamStore.getState().subscribe(['t1', 't2']);

    expect(mockDocumentId).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalledWith('__id__', 'in', ['t1', 't2']);
  });

  it('does NOT use the isDeleted inequality filter for non-admin users', () => {
    useTeamStore.getState().subscribe(['t1']);

    const whereArgs = mockWhere.mock.calls.map(c => c[0] as string);
    expect(whereArgs).not.toContain('isDeleted');
  });

  it('returns a no-op unsubscribe and sets loading: false when userTeamIds is empty', () => {
    const unsub = useTeamStore.getState().subscribe([]);
    expect(mockOnSnapshot).not.toHaveBeenCalled();
    expect(useTeamStore.getState().loading).toBe(false);
    expect(() => unsub()).not.toThrow();
  });

  it('opens only one snapshot listener (no deleted-teams listener)', () => {
    useTeamStore.getState().subscribe(['t1']);
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
  });

  it('keeps deletedTeams empty for non-admin users', () => {
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshotDocs([]));
      return () => {};
    });

    useTeamStore.getState().subscribe(['t1']);

    expect(useTeamStore.getState().deletedTeams).toEqual([]);
  });

  it('tears down only the main listener when unsubscribe is called for non-admin', () => {
    const unsubMain = vi.fn();

    mockOnSnapshot.mockImplementationOnce(() => unsubMain);

    const unsub = useTeamStore.getState().subscribe(['t1']);
    unsub();

    expect(unsubMain).toHaveBeenCalledOnce();
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
  });

  it('caps the documentId filter at 30 IDs (Firestore in-query limit)', () => {
    const manyIds = Array.from({ length: 35 }, (_, i) => `team-${i}`);
    useTeamStore.getState().subscribe(manyIds);
    const inCall = mockWhere.mock.calls.find(c => c[1] === 'in');
    expect(inCall).toBeDefined();
    expect((inCall![2] as string[]).length).toBe(30);
  });
});

// ── subscribe() — reactive re-subscription (race-condition fix) ───────────────
//
// Steps 1–3 of the TDD plan from issue #686.
//
// The root cause: subscribe() reads profile?.role at call-time. Auth has a race
// window where user is set but profile (loaded via a separate onSnapshot) is
// still null. MainLayout calls subscribe() as soon as user is set, so:
//   - profile?.role === 'admin' → false (profile is null)
//   - non-admin branch fires with empty userTeamIds []
//   - where(documentId(), 'in', []) → malformed query that hangs forever
//
// Fix: subscribe() internally watches useAuthStore and re-opens the correct
// listener when profile.role / profile.memberships arrive after the initial call.

describe('useTeamStore — subscribe (reactive re-subscription on profile arrival)', () => {
  it('RED→GREEN: re-opens admin listener when profile.role changes null → admin', () => {
    // Start with profile null (race window: user set but profile not loaded yet).
    mockGetAuthState.mockReturnValue({ profile: null });
    mockOnSnapshot.mockReturnValue(() => {});

    // subscribe() called immediately on user sign-in (profile still null).
    const unsub = useTeamStore.getState().subscribe([]);

    // No Firestore listener should have fired yet — nothing to subscribe to.
    // (Profile null + empty teamIds → no-op initially is acceptable, but the
    // key assertion is that a listener DOES open once profile arrives.)
    const snapshotCallsBefore = mockOnSnapshot.mock.calls.length;

    // Profile arrives (simulates onSnapshot for users/<uid> firing).
    simulateAuthChange({ role: 'admin', memberships: [] });

    // Now the admin Firestore listener must have been opened.
    expect(mockOnSnapshot.mock.calls.length).toBeGreaterThan(snapshotCallsBefore);
    expect(mockWhere).toHaveBeenCalledWith('isDeleted', '!=', true);

    unsub();
  });

  it('RED→GREEN: re-opens non-admin listener when profile.memberships change (coach gains a team)', () => {
    // Start with coach profile that has no teams yet.
    mockGetAuthState.mockReturnValue({ profile: { role: 'coach', memberships: [] } });
    mockOnSnapshot.mockReturnValue(() => {});

    const unsub = useTeamStore.getState().subscribe([]);

    const snapshotCallsBefore = mockOnSnapshot.mock.calls.length;

    // Coach gains a team membership (admin adds them to a team).
    simulateAuthChange({ role: 'coach', memberships: [{ role: 'coach', teamId: 'new-team-1' }] });

    // A new listener scoped to new-team-1 must have opened.
    expect(mockOnSnapshot.mock.calls.length).toBeGreaterThan(snapshotCallsBefore);
    expect(mockDocumentId).toHaveBeenCalled();

    unsub();
  });

  it('RED→GREEN: tears down old listener before opening new one on re-subscription', () => {
    const oldUnsub = vi.fn();
    mockGetAuthState.mockReturnValue({ profile: { role: 'coach', memberships: [{ role: 'coach', teamId: 't1' }] } });
    mockOnSnapshot.mockReturnValue(oldUnsub);

    const masterUnsub = useTeamStore.getState().subscribe(['t1']);

    // Old listener is open. Now role changes to admin.
    simulateAuthChange({ role: 'admin', memberships: [] });

    // Old listener must have been torn down before new admin listener opened.
    expect(oldUnsub).toHaveBeenCalled();

    masterUnsub();
  });

  it('RED→GREEN: cleans up auth watcher when master unsub is called', () => {
    mockGetAuthState.mockReturnValue({ profile: { role: 'admin' } });
    mockOnSnapshot.mockReturnValue(() => {});

    const unsub = useTeamStore.getState().subscribe([]);
    expect(mockAuthSubscribe).toHaveBeenCalled();

    unsub();

    // After unsub, auth listener should be removed (no-op on further changes).
    const snapshotCallsBefore = mockOnSnapshot.mock.calls.length;
    simulateAuthChange({ role: 'admin', memberships: [] });
    expect(mockOnSnapshot.mock.calls.length).toBe(snapshotCallsBefore);
  });
});

describe('useTeamStore — subscribe (empty in-query guard)', () => {
  it('RED→GREEN: never issues where(documentId(), in, []) when non-admin and no teamIds', () => {
    mockGetAuthState.mockReturnValue({ profile: { role: 'coach', memberships: [] } });
    mockOnSnapshot.mockReturnValue(() => {});

    useTeamStore.getState().subscribe([]);

    // Guard must prevent the malformed empty in-query from ever reaching Firestore.
    const inCalls = mockWhere.mock.calls.filter(c => c[1] === 'in' && Array.isArray(c[2]) && (c[2] as unknown[]).length === 0);
    expect(inCalls).toHaveLength(0);

    // And loading should be false (not hanging forever).
    expect(useTeamStore.getState().loading).toBe(false);
  });

  it('sets teams: [] and loading: false immediately when non-admin has no teamIds on subscribe', () => {
    mockGetAuthState.mockReturnValue({ profile: { role: 'parent', memberships: [] } });

    useTeamStore.getState().subscribe([]);

    expect(useTeamStore.getState().teams).toEqual([]);
    expect(useTeamStore.getState().loading).toBe(false);
  });
});

// ── updateTeam() ──────────────────────────────────────────────────────────────

describe('useTeamStore — updateTeam', () => {
  it('calls setDoc with the team data', async () => {
    const team = makeTeam('t1');
    await useTeamStore.getState().updateTeam(team);
    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('strips undefined values before writing to Firestore', async () => {
    const team = makeTeam('t1', { homeVenue: undefined, logoUrl: undefined });
    await useTeamStore.getState().updateTeam(team);
    const writtenData = mockSetDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(writtenData)).not.toContain('homeVenue');
    expect(Object.keys(writtenData)).not.toContain('logoUrl');
  });

  it('propagates errors from Firestore', async () => {
    mockSetDoc.mockRejectedValue(new Error('Write failed'));
    await expect(useTeamStore.getState().updateTeam(makeTeam('t1'))).rejects.toThrow('Write failed');
  });
});

// ── addTeamToLeague() ─────────────────────────────────────────────────────────

describe('useTeamStore — addTeamToLeague', () => {
  it('calls updateDoc with arrayUnion for leagueIds', async () => {
    await useTeamStore.getState().addTeamToLeague('team-1', 'league-A');
    expect(mockUpdateDoc).toHaveBeenCalledOnce();
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.leagueIds).toEqual({ _union: 'league-A' });
  });

  it('sets _managedLeagueId to the added leagueId', async () => {
    await useTeamStore.getState().addTeamToLeague('team-1', 'league-B');
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(patch._managedLeagueId).toBe('league-B');
  });
});

// ── removeTeamFromLeague() ────────────────────────────────────────────────────

describe('useTeamStore — removeTeamFromLeague', () => {
  it('calls updateDoc with arrayRemove for leagueIds', async () => {
    await useTeamStore.getState().removeTeamFromLeague('team-1', 'league-A');
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.leagueIds).toEqual({ _remove: 'league-A' });
  });

  it('sets _managedLeagueId to the removed leagueId (auth hint for rules)', async () => {
    await useTeamStore.getState().removeTeamFromLeague('team-1', 'league-C');
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(patch._managedLeagueId).toBe('league-C');
  });
});

// ── softDeleteTeam() ──────────────────────────────────────────────────────────

describe('useTeamStore — softDeleteTeam', () => {
  it('sets isDeleted: true on the team document', async () => {
    await useTeamStore.getState().softDeleteTeam('team-99');
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.isDeleted).toBe(true);
  });

  it('sets a non-null deletedAt timestamp', async () => {
    await useTeamStore.getState().softDeleteTeam('team-99');
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof patch.deletedAt).toBe('string');
    expect(patch.deletedAt).not.toBeNull();
  });
});

// ── restoreTeam() ─────────────────────────────────────────────────────────────

describe('useTeamStore — restoreTeam', () => {
  it('sets isDeleted: false on the team document', async () => {
    await useTeamStore.getState().restoreTeam('team-99');
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.isDeleted).toBe(false);
  });

  it('sets deletedAt to null (clears the field)', async () => {
    await useTeamStore.getState().restoreTeam('team-99');
    const patch = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.deletedAt).toBeNull();
  });
});

// ── hardDeleteTeam() ──────────────────────────────────────────────────────────
//
// The store now delegates to the hardDeleteTeam Cloud Function callable instead
// of calling deleteDoc directly. The CF uses Admin SDK recursiveDelete so that
// subcollections (messages, availability) are removed along with the team doc.

describe('useTeamStore — hardDeleteTeam', () => {
  it('invokes the hardDeleteTeam callable with the correct teamId', async () => {
    await useTeamStore.getState().hardDeleteTeam('team-42');
    expect(mockHttpsCallable).toHaveBeenCalledWith({}, 'hardDeleteTeam');
    expect(mockHttpsCallableFn).toHaveBeenCalledWith({ teamId: 'team-42' });
  });

  it('propagates errors thrown by the callable', async () => {
    mockHttpsCallableFn.mockRejectedValue(new Error('permission-denied'));
    await expect(useTeamStore.getState().hardDeleteTeam('team-42')).rejects.toThrow('permission-denied');
  });

  it('does NOT call deleteDoc (subcollection removal is server-side only)', async () => {
    await useTeamStore.getState().hardDeleteTeam('team-42');
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });
});
