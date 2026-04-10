/**
 * usePlayerStore — sensitiveData write/read round-trip
 *
 * Covers the specific bug: after addSensitiveData or updateSensitiveData resolves,
 * the players array in the Zustand store must immediately reflect the new sensitive
 * fields WITHOUT waiting for an onSnapshot callback.
 *
 * Root cause under test: both write functions update _sensitiveMap but do NOT call
 * set(...) to rebuild the players array. The store only updates players when either:
 *   (a) the main-player onSnapshot fires, or
 *   (b) the sensitiveData onSnapshot fires.
 * If subscribe() was never called (or the sensitive subscription was skipped because
 * isPrivileged was false at subscribe time), the players array is never updated.
 *
 * Secondary issue surfaced by tests: _sensitiveMap is module-level mutable state.
 * usePlayerStore.setState() does NOT reset it. Tests must use unique player IDs
 * per test case to avoid cross-test contamination.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Player, SensitivePlayerData } from '@/types';

// ── Mock firebase/firestore ───────────────────────────────────────────────────

const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
const mockCollection = vi.fn();
const mockCollectionGroup = vi.fn();
const mockOrderBy = vi.fn();
const mockQuery = vi.fn((..._args: unknown[]) => ({ _type: 'query' }));
const mockOnSnapshot = vi.fn(() => () => {});
const mockDeleteDoc = vi.fn().mockResolvedValue(undefined);
const mockWriteBatch = vi.fn(() => ({
  delete: vi.fn(),
  commit: vi.fn().mockResolvedValue(undefined),
}));

const mockWhere = vi.fn((...args: unknown[]) => ({ _type: 'where', args }));

vi.mock('firebase/firestore', () => ({
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  doc: (...args: unknown[]) => mockDoc(...(args as Parameters<typeof mockDoc>)),
  collection: (...args: unknown[]) => mockCollection(...args),
  collectionGroup: (...args: unknown[]) => mockCollectionGroup(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...(args as Parameters<typeof mockOnSnapshot>)),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  writeBatch: (...args: unknown[]) => mockWriteBatch(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

const mockAuthGetState = vi.fn(() => ({
  profile: { role: 'coach' },
}));

vi.mock('./useAuthStore', () => ({
  useAuthStore: {
    getState: () => mockAuthGetState(),
    subscribe: vi.fn(() => vi.fn()), // no-op subscribe; store uses this to watch auth changes
  },
  getActiveMembership: (profile: { teamId?: string } | null) =>
    profile ? { teamId: profile.teamId } : null,
}));

// ── Import store AFTER mocks are registered ───────────────────────────────────

import { usePlayerStore } from './usePlayerStore';

// ── Test ID counter ───────────────────────────────────────────────────────────
// _sensitiveMap is module-level state that is NOT cleared by usePlayerStore.setState().
// Using a unique player ID per test prevents cross-test contamination from that map.

let _testIdCounter = 0;
function nextPlayerId(): string {
  return `player-test-${++_testIdCounter}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlayer(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    teamId: 'team-1',
    firstName: 'Alex',
    lastName: 'Smith',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Seeds one base player into the store by firing the captured onSnapshot callback
 * that subscribe() registers for the main players collection (first call to
 * mockOnSnapshot). Returns an unsub to clean up.
 */
function seedBasePlayerViaSnapshot(player: Player): void {
  const snapCallbacks: Array<(snap: unknown) => void> = [];
  mockOnSnapshot.mockImplementation((_, cb) => {
    snapCallbacks.push(cb as (snap: unknown) => void);
    return () => {};
  });

  usePlayerStore.getState().subscribe();

  if (snapCallbacks.length > 0) {
    snapCallbacks[0]({
      docs: [{ data: () => ({ ...player }), id: player.id }],
    });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('usePlayerStore — sensitiveData store update after write (the bug)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthGetState.mockReturnValue({ profile: { role: 'coach', teamId: 'team-1' } });
    usePlayerStore.setState({ players: [], loading: true });
  });

  // ── addSensitiveData ────────────────────────────────────────────────────────

  describe('addSensitiveData', () => {
    it('writes to the correct Firestore subcollection path', async () => {
      const playerId = nextPlayerId();
      await usePlayerStore.getState().addSensitiveData(playerId, 'team-1', {
        parentContact: { parentName: 'Jane Smith', parentPhone: '555-0001' },
      });

      expect(mockDoc).toHaveBeenCalledWith(
        expect.anything(), // db
        'players',
        playerId,
        'sensitiveData',
        'private',
      );
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: `players/${playerId}/sensitiveData/private` }),
        expect.objectContaining({ playerId, teamId: 'team-1' }),
      );
    });

    it('immediately reflects parentContact in the players array without a snapshot callback', async () => {
      // Arrange: seed one base player in the store via snapshot.
      const playerId = nextPlayerId();
      seedBasePlayerViaSnapshot(makePlayer(playerId));

      // Act: save sensitive data — simulates coach clicking "Add Player" with parent info.
      await usePlayerStore.getState().addSensitiveData(playerId, 'team-1', {
        parentContact: { parentName: 'Jane Smith', parentPhone: '555-0001' },
      });

      // Assert: the store players array should NOW include parentContact WITHOUT
      // waiting for a Firestore onSnapshot callback.
      // THIS IS THE BUG — the assertion below will FAIL against the current code
      // because addSensitiveData does not call set(...) after updating _sensitiveMap.
      const player = usePlayerStore.getState().players.find(p => p.id === playerId);
      expect(player?.parentContact).toEqual({ parentName: 'Jane Smith', parentPhone: '555-0001' });
    });

    it('immediately reflects parentContact2 in the players array without a snapshot callback', async () => {
      const playerId = nextPlayerId();
      seedBasePlayerViaSnapshot(makePlayer(playerId));

      await usePlayerStore.getState().addSensitiveData(playerId, 'team-1', {
        parentContact2: { parentName: 'Bob Smith', parentPhone: '555-0002', parentEmail: 'bob@example.com' },
      });

      const player = usePlayerStore.getState().players.find(p => p.id === playerId);
      expect(player?.parentContact2).toEqual({
        parentName: 'Bob Smith',
        parentPhone: '555-0002',
        parentEmail: 'bob@example.com',
      });
    });

    it('immediately reflects emergencyContact in the players array without a snapshot callback', async () => {
      const playerId = nextPlayerId();
      seedBasePlayerViaSnapshot(makePlayer(playerId));

      await usePlayerStore.getState().addSensitiveData(playerId, 'team-1', {
        emergencyContact: { name: 'Uncle Bob', phone: '555-0003', relationship: 'Uncle' },
      });

      const player = usePlayerStore.getState().players.find(p => p.id === playerId);
      expect(player?.emergencyContact).toEqual({ name: 'Uncle Bob', phone: '555-0003', relationship: 'Uncle' });
    });

    it('does not expose sensitive fields to non-privileged roles after addSensitiveData', async () => {
      // A parent role should never see merged sensitive data in the players array.
      // Re-seed with a non-privileged role so subscribe() builds the right state.
      mockAuthGetState.mockReturnValue({ profile: { role: 'parent' } });

      const playerId = nextPlayerId();
      seedBasePlayerViaSnapshot(makePlayer(playerId));

      await usePlayerStore.getState().addSensitiveData(playerId, 'team-1', {
        parentContact: { parentName: 'Jane Smith', parentPhone: '555-0001' },
      });

      // The fix must call buildMergedPlayers with the current auth role when
      // calling set() inside addSensitiveData. For a non-privileged caller,
      // parentContact must remain absent from the players array.
      const player = usePlayerStore.getState().players.find(p => p.id === playerId);
      expect(player?.parentContact).toBeUndefined();
    });
  });

  // ── updateSensitiveData ─────────────────────────────────────────────────────

  describe('updateSensitiveData', () => {
    it('writes the merged document to the correct Firestore path', async () => {
      const playerId = nextPlayerId();
      await usePlayerStore.getState().updateSensitiveData(playerId, 'team-1', {
        parentContact: { parentName: 'Updated Name', parentPhone: '555-9999' },
      });

      expect(mockDoc).toHaveBeenCalledWith(
        expect.anything(),
        'players',
        playerId,
        'sensitiveData',
        'private',
      );
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: `players/${playerId}/sensitiveData/private` }),
        expect.objectContaining({
          playerId,
          teamId: 'team-1',
          parentContact: { parentName: 'Updated Name', parentPhone: '555-9999' },
        }),
      );
    });

    it('preserves existing sensitive fields when updating a single field', async () => {
      // Arrange: first write gives the player both parentContact fields.
      const playerId = nextPlayerId();
      seedBasePlayerViaSnapshot(makePlayer(playerId));
      await usePlayerStore.getState().addSensitiveData(playerId, 'team-1', {
        parentContact: { parentName: 'Jane Smith', parentPhone: '555-0001' },
        parentContact2: { parentName: 'Bob Smith', parentPhone: '555-0002' },
      });

      // Act: update only parentContact — parentContact2 must be preserved.
      await usePlayerStore.getState().updateSensitiveData(playerId, 'team-1', {
        parentContact: { parentName: 'Jane Updated', parentPhone: '555-0001' },
      });

      const lastCall = mockSetDoc.mock.calls[mockSetDoc.mock.calls.length - 1] as [unknown, SensitivePlayerData];
      const writtenDoc = lastCall[1];
      expect(writtenDoc.parentContact?.parentName).toBe('Jane Updated');
      expect(writtenDoc.parentContact2?.parentName).toBe('Bob Smith');
    });

    it('immediately reflects updated parentContact in the players array without a snapshot callback', async () => {
      const playerId = nextPlayerId();
      seedBasePlayerViaSnapshot(makePlayer(playerId));
      await usePlayerStore.getState().addSensitiveData(playerId, 'team-1', {
        parentContact: { parentName: 'Jane Smith', parentPhone: '555-0001' },
      });

      // Act: update the contact.
      await usePlayerStore.getState().updateSensitiveData(playerId, 'team-1', {
        parentContact: { parentName: 'Jane Updated', parentPhone: '555-0001' },
      });

      // Assert: the players array should reflect the change synchronously, without
      // a snapshot round-trip. THIS IS THE BUG.
      const player = usePlayerStore.getState().players.find(p => p.id === playerId);
      expect(player?.parentContact?.parentName).toBe('Jane Updated');
    });

    it('immediately reflects updated emergencyContact in the players array without a snapshot callback', async () => {
      const playerId = nextPlayerId();
      seedBasePlayerViaSnapshot(makePlayer(playerId));
      await usePlayerStore.getState().addSensitiveData(playerId, 'team-1', {
        emergencyContact: { name: 'Uncle Bob', phone: '555-0003' },
      });

      await usePlayerStore.getState().updateSensitiveData(playerId, 'team-1', {
        emergencyContact: { name: 'Aunt Carol', phone: '555-0004', relationship: 'Aunt' },
      });

      const player = usePlayerStore.getState().players.find(p => p.id === playerId);
      expect(player?.emergencyContact?.name).toBe('Aunt Carol');
    });

    it('handles updating a player with no prior sensitive data (cold start)', async () => {
      // No prior addSensitiveData call — _sensitiveMap entry starts empty for this id.
      const playerId = nextPlayerId();
      seedBasePlayerViaSnapshot(makePlayer(playerId));

      await usePlayerStore.getState().updateSensitiveData(playerId, 'team-1', {
        parentContact: { parentName: 'First Write', parentPhone: '555-1111' },
      });

      const player = usePlayerStore.getState().players.find(p => p.id === playerId);
      expect(player?.parentContact?.parentName).toBe('First Write');
    });
  });

  // ── Snapshot path (control — these should always pass) ─────────────────────

  describe('sensitiveData onSnapshot callback (control path)', () => {
    it('merges sensitive fields into players when the snapshot fires for a privileged user', () => {
      // Arrange: capture both onSnapshot callbacks registered by subscribe().
      const snapCallbacks: Array<(snap: unknown) => void> = [];
      mockOnSnapshot.mockImplementation((_, cb) => {
        snapCallbacks.push(cb as (snap: unknown) => void);
        return () => {};
      });

      const playerId = nextPlayerId();
      usePlayerStore.getState().subscribe();

      // Fire the main-player snapshot.
      snapCallbacks[0]?.({
        docs: [{ data: () => ({ ...makePlayer(playerId) }), id: playerId }],
      });

      // Fire the sensitiveData snapshot (second callback).
      snapCallbacks[1]?.({
        docs: [{
          data: () => ({
            playerId,
            teamId: 'team-1',
            parentContact: { parentName: 'Jane Smith', parentPhone: '555-0001' },
          }),
          id: 'private',
        }],
      });

      const player = usePlayerStore.getState().players.find(p => p.id === playerId);
      expect(player?.parentContact?.parentName).toBe('Jane Smith');
    });

    it('does NOT start a sensitiveData subscription for non-privileged users', () => {
      mockAuthGetState.mockReturnValue({ profile: { role: 'parent' } });

      const snapCallbacks: Array<(snap: unknown) => void> = [];
      mockOnSnapshot.mockImplementation((_, cb) => {
        snapCallbacks.push(cb as (snap: unknown) => void);
        return () => {};
      });

      usePlayerStore.getState().subscribe();

      // For a non-privileged user, subscribe() returns early after registering
      // only the main player subscription — exactly one onSnapshot call.
      expect(snapCallbacks).toHaveLength(1);
    });

    it('does NOT expose sensitive fields for non-privileged users even if snapshot fires', () => {
      mockAuthGetState.mockReturnValue({ profile: { role: 'parent' } });

      const snapCallbacks: Array<(snap: unknown) => void> = [];
      mockOnSnapshot.mockImplementation((_, cb) => {
        snapCallbacks.push(cb as (snap: unknown) => void);
        return () => {};
      });

      const playerId = nextPlayerId();
      usePlayerStore.getState().subscribe();

      snapCallbacks[0]?.({
        docs: [{ data: () => ({ ...makePlayer(playerId) }), id: playerId }],
      });

      const player = usePlayerStore.getState().players.find(p => p.id === playerId);
      expect(player?.parentContact).toBeUndefined();
    });
  });
});

// ── PlayerForm save path integration (store-level) ───────────────────────────
// These tests mirror what PlayerForm.handleSubmit() does when editing a player:
// updatePlayer() then updateSensitiveData(). The player card should reflect the
// new parent contact after both calls resolve — without any snapshot callback.

describe('usePlayerStore — PlayerForm edit save path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthGetState.mockReturnValue({ profile: { role: 'coach', teamId: 'team-1' } });
    usePlayerStore.setState({ players: [], loading: true });
  });

  it('reflects parent contact on the player card after a coach edits a player', async () => {
    const playerId = nextPlayerId();
    const player = makePlayer(playerId);
    seedBasePlayerViaSnapshot(player);

    // Simulate PlayerForm.handleSubmit for an edit with parent data.
    await usePlayerStore.getState().updatePlayer({
      ...player,
      updatedAt: new Date().toISOString(),
    });

    await usePlayerStore.getState().updateSensitiveData(playerId, player.teamId, {
      parentContact: { parentName: 'Jane Smith', parentPhone: '555-0001', parentEmail: 'jane@example.com' },
    });

    // The player card component reads from store.players — this is the bug surface.
    const storePlayer = usePlayerStore.getState().players.find(p => p.id === playerId);
    expect(storePlayer?.parentContact).toEqual({
      parentName: 'Jane Smith',
      parentPhone: '555-0001',
      parentEmail: 'jane@example.com',
    });
  });

  it('reflects both parent contacts after a coach saves a new player', async () => {
    const playerId = nextPlayerId();
    const newPlayer = makePlayer(playerId);
    seedBasePlayerViaSnapshot(newPlayer);

    await usePlayerStore.getState().addSensitiveData(playerId, 'team-1', {
      parentContact: { parentName: 'Jane Smith', parentPhone: '555-0001' },
      parentContact2: { parentName: 'Bob Smith', parentPhone: '555-0002' },
    });

    const storePlayer = usePlayerStore.getState().players.find(p => p.id === playerId);
    expect(storePlayer?.parentContact?.parentName).toBe('Jane Smith');
    expect(storePlayer?.parentContact2?.parentName).toBe('Bob Smith');
  });

  it('reflects emergency contact after saving', async () => {
    const playerId = nextPlayerId();
    const player = makePlayer(playerId);
    seedBasePlayerViaSnapshot(player);

    await usePlayerStore.getState().updateSensitiveData(playerId, player.teamId, {
      emergencyContact: { name: 'Emergency Person', phone: '911', relationship: 'Neighbor' },
    });

    const storePlayer = usePlayerStore.getState().players.find(p => p.id === playerId);
    expect(storePlayer?.emergencyContact?.name).toBe('Emergency Person');
  });
});
