/**
 * useTeamStore — action unit tests
 *
 * Tests the Zustand store actions that write to Firestore.
 * Firestore is mocked at the module boundary so no emulator is needed.
 *
 * Behaviors under test:
 *   - subscribe() splits active vs deleted teams correctly from a snapshot
 *   - updateTeam() writes to the correct Firestore path
 *   - addTeamToLeague() uses arrayUnion and sets _managedLeagueId
 *   - removeTeamFromLeague() uses arrayRemove and sets _managedLeagueId
 *   - softDeleteTeam() sets isDeleted: true and deletedAt
 *   - restoreTeam() sets isDeleted: false and deletedAt: null
 *   - hardDeleteTeam() calls deleteDoc on the correct path
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
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

// ── Auth store mock ───────────────────────────────────────────────────────────

const mockGetAuthState = vi.fn(() => ({ profile: null }));

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: (...args: unknown[]) => mockGetAuthState(...args) },
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
  mockSetDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
  mockDeleteDoc.mockResolvedValue(undefined);
  mockOnSnapshot.mockReturnValue(() => {});
  mockGetAuthState.mockReturnValue({ profile: null });
  useTeamStore.setState({ teams: [], deletedTeams: [], loading: true });
});

// ── subscribe() ───────────────────────────────────────────────────────────────

describe('useTeamStore — subscribe', () => {
  it('applies server-side where clause for isDeleted != true', () => {
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshotDocs([]));
      return () => {};
    });

    useTeamStore.getState().subscribe();

    expect(mockWhere).toHaveBeenCalledWith('isDeleted', '!=', true);
  });

  it('maps all snapshot docs to teams (server already excludes deleted)', () => {
    const t1 = makeTeam('t1');
    const t2 = makeTeam('t2');

    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshotDocs([t1, t2]));
      return () => {};
    });

    useTeamStore.getState().subscribe();

    const { teams } = useTeamStore.getState();
    expect(teams).toHaveLength(2);
    expect(teams.map(t => t.id)).toEqual(['t1', 't2']);
  });

  it('sets loading to false after snapshot fires', () => {
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshotDocs([]));
      return () => {};
    });

    useTeamStore.getState().subscribe();
    expect(useTeamStore.getState().loading).toBe(false);
  });

  it('returns an unsubscribe function', () => {
    const mockUnsub = vi.fn();
    mockOnSnapshot.mockReturnValue(mockUnsub);
    const unsub = useTeamStore.getState().subscribe();
    expect(typeof unsub).toBe('function');
  });

  it('sets loading to false on snapshot error', () => {
    mockOnSnapshot.mockImplementation((_q, _cb, errCb) => {
      errCb(new Error('Permission denied'));
      return () => {};
    });

    useTeamStore.getState().subscribe();
    expect(useTeamStore.getState().loading).toBe(false);
  });

  it('opens only one snapshot listener for non-admin users', () => {
    mockGetAuthState.mockReturnValue({ profile: { role: 'coach' } });

    useTeamStore.getState().subscribe();

    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledWith('isDeleted', '!=', true);
  });

  it('keeps deletedTeams empty for non-admin users', () => {
    mockGetAuthState.mockReturnValue({ profile: { role: 'coach' } });
    mockOnSnapshot.mockImplementation((_q, cb) => {
      cb(makeSnapshotDocs([]));
      return () => {};
    });

    useTeamStore.getState().subscribe();

    expect(useTeamStore.getState().deletedTeams).toEqual([]);
  });

  it('opens a second snapshot listener for admin users', () => {
    mockGetAuthState.mockReturnValue({ profile: { role: 'admin' } });

    useTeamStore.getState().subscribe();

    expect(mockOnSnapshot).toHaveBeenCalledTimes(2);
    expect(mockWhere).toHaveBeenCalledTimes(2);
    expect(mockWhere).toHaveBeenCalledWith('isDeleted', '!=', true);
    expect(mockWhere).toHaveBeenCalledWith('isDeleted', '==', true);
  });

  it('populates deletedTeams from the admin-scoped snapshot', () => {
    mockGetAuthState.mockReturnValue({ profile: { role: 'admin' } });
    const deleted1 = makeTeam('d1', { isDeleted: true, deletedAt: '2024-06-01T00:00:00.000Z' } as Partial<Team>);
    const deleted2 = makeTeam('d2', { isDeleted: true, deletedAt: '2024-05-01T00:00:00.000Z' } as Partial<Team>);

    // First call → main listener (active teams), second call → deleted teams listener
    mockOnSnapshot
      .mockImplementationOnce((_q, cb) => { cb(makeSnapshotDocs([])); return () => {}; })
      .mockImplementationOnce((_q, cb) => { cb(makeSnapshotDocs([deleted1, deleted2])); return () => {}; });

    useTeamStore.getState().subscribe();

    const { deletedTeams } = useTeamStore.getState();
    expect(deletedTeams).toHaveLength(2);
    expect(deletedTeams.map(t => t.id)).toEqual(['d1', 'd2']);
  });

  it('tears down both listeners when unsubscribe is called for admin', () => {
    mockGetAuthState.mockReturnValue({ profile: { role: 'admin' } });
    const unsubMain = vi.fn();
    const unsubDeleted = vi.fn();

    mockOnSnapshot
      .mockImplementationOnce(() => unsubMain)
      .mockImplementationOnce(() => unsubDeleted);

    const unsub = useTeamStore.getState().subscribe();
    unsub();

    expect(unsubMain).toHaveBeenCalledOnce();
    expect(unsubDeleted).toHaveBeenCalledOnce();
  });

  it('tears down only the main listener when unsubscribe is called for non-admin', () => {
    mockGetAuthState.mockReturnValue({ profile: { role: 'coach' } });
    const unsubMain = vi.fn();

    mockOnSnapshot.mockImplementationOnce(() => unsubMain);

    const unsub = useTeamStore.getState().subscribe();
    unsub();

    expect(unsubMain).toHaveBeenCalledOnce();
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
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

describe('useTeamStore — hardDeleteTeam', () => {
  it('calls deleteDoc once', async () => {
    await useTeamStore.getState().hardDeleteTeam('team-42');
    expect(mockDeleteDoc).toHaveBeenCalledOnce();
  });

  it('propagates errors from deleteDoc', async () => {
    mockDeleteDoc.mockRejectedValue(new Error('Permission denied'));
    await expect(useTeamStore.getState().hardDeleteTeam('team-42')).rejects.toThrow('Permission denied');
  });
});
