import { create } from 'zustand';
import {
  collection, collectionGroup, onSnapshot, doc, setDoc, deleteDoc,
  query, orderBy, where, writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthStore } from './useAuthStore';
import type { Player, SensitivePlayerData } from '@/types';

// Module-level caches — shared across the singleton store instance.
// Updated by onSnapshot callbacks and merged before storing in Zustand state.
let _basePlayers: Player[] = [];
const _sensitiveMap: Record<string, SensitivePlayerData> = {};

function buildMergedPlayers(isPrivileged: boolean): Player[] {
  return _basePlayers.map(p => {
    if (!isPrivileged) {
      // Strip coach-only fields for players/parents.
      const safe = { ...p };
      delete (safe as Partial<Player>).statusNote;
      return safe;
    }
    // Merge sensitive PII for coaches/admins — all existing component
    // code reads from the player object directly so nothing else changes.
    const sensitive = _sensitiveMap[p.id];
    return sensitive ? { ...p, ...sensitive } : p;
  });
}

interface PlayerStore {
  players: Player[];
  loading: boolean;
  subscribe: () => () => void;
  addPlayer: (player: Player) => Promise<void>;
  addSensitiveData: (playerId: string, teamId: string, data: Partial<SensitivePlayerData>) => Promise<void>;
  updatePlayer: (player: Player) => Promise<void>;
  updateSensitiveData: (playerId: string, teamId: string, data: Partial<SensitivePlayerData>) => Promise<void>;
  deletePlayer: (id: string) => Promise<void>;
  deletePlayersForTeam: (teamId: string) => Promise<void>;
}

export const usePlayerStore = create<PlayerStore>((set) => ({
  players: [],
  loading: true,

  subscribe: () => {
    const getPriv = () => ['admin', 'coach', 'league_manager']
      .includes(useAuthStore.getState().profile?.role ?? '');

    // ── Main player docs ───────────────────────────────────────────────────────
    // Admins get an unfiltered query (isAdmin() is query-safe in rules).
    // All other roles must filter by teamId — the rule uses resource.data.teamId
    // which makes unfiltered list queries fail with permission-denied.
    let activePlayerUnsub: (() => void) | null = null;

    function buildPlayerQuery() {
      const profile = useAuthStore.getState().profile;
      if (profile?.role === 'admin') {
        return query(collection(db, 'players'), orderBy('createdAt'));
      }
      if (profile?.teamId) {
        return query(
          collection(db, 'players'),
          where('teamId', '==', profile.teamId),
          orderBy('createdAt'),
        );
      }
      return null; // no teamId yet — wait for profile to load
    }

    function subscribeToPlayers() {
      activePlayerUnsub?.();
      const q = buildPlayerQuery();
      if (!q) {
        set({ players: [], loading: false });
        return;
      }
      activePlayerUnsub = onSnapshot(
        q,
        (snap) => {
          _basePlayers = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Player);
          set({ players: buildMergedPlayers(getPriv()), loading: false });
        },
        () => set({ loading: false }),
      );
    }

    subscribeToPlayers();

    // ── Sensitive PII subcollection ────────────────────────────────────────────
    // Always subscribe — Firestore rules deny non-privileged users server-side.
    const sensitiveUnsub = onSnapshot(
      collectionGroup(db, 'sensitiveData'),
      (snap) => {
        snap.docs.forEach(d => {
          const data = d.data() as SensitivePlayerData;
          if (data.playerId) _sensitiveMap[data.playerId] = data;
        });
        set(state => ({ players: buildMergedPlayers(getPriv()), loading: state.loading }));
      },
      (error) => {
        if (error.code !== 'permission-denied') {
          console.error('sensitiveData subscription error:', error);
        }
      },
    );

    // ── Rebuild when profile role or teamId changes ───────────────────────────
    // Snapshots fire before the profile loads from Firestore. When role or teamId
    // arrives (null → 'coach', teamId undefined → actual id), re-subscribe with
    // the correct filtered query and rebuild merged players.
    let lastRole: string | undefined = useAuthStore.getState().profile?.role;
    let lastTeamId: string | undefined = useAuthStore.getState().profile?.teamId;
    const authUnsub = useAuthStore.subscribe((state) => {
      const role = state.profile?.role;
      const teamId = state.profile?.teamId;
      if (role !== lastRole || teamId !== lastTeamId) {
        lastRole = role;
        lastTeamId = teamId;
        subscribeToPlayers(); // re-subscribe with the new query
        set(s => ({ players: buildMergedPlayers(getPriv()), loading: s.loading }));
      }
    });

    return () => {
      activePlayerUnsub?.();
      sensitiveUnsub();
      authUnsub();
    };
  },

  addPlayer: async (player) => {
    // Write only non-sensitive fields to the main player doc.
    const { dateOfBirth: _dob, parentContact: _pc, parentContact2: _pc2, emergencyContact: _ec, ...mainFields } = player;
    await setDoc(doc(db, 'players', player.id), mainFields);
  },

  addSensitiveData: async (playerId, teamId, data) => {
    const docData: SensitivePlayerData = { playerId, teamId, ...data };
    await setDoc(doc(db, 'players', playerId, 'sensitiveData', 'private'), docData);
    _sensitiveMap[playerId] = docData;
    const priv = ['admin', 'coach', 'league_manager'].includes(useAuthStore.getState().profile?.role ?? '');
    set(state => ({ players: buildMergedPlayers(priv), loading: state.loading }));
  },

  updatePlayer: async (player) => {
    const { dateOfBirth: _dob, parentContact: _pc, parentContact2: _pc2, emergencyContact: _ec, ...mainFields } = player;
    await setDoc(doc(db, 'players', player.id), mainFields);
  },

  updateSensitiveData: async (playerId, teamId, data) => {
    const existing = _sensitiveMap[playerId] ?? { playerId, teamId };
    const updated: SensitivePlayerData = { ...existing, ...data, playerId, teamId };
    await setDoc(doc(db, 'players', playerId, 'sensitiveData', 'private'), updated);
    _sensitiveMap[playerId] = updated;
    const priv = ['admin', 'coach', 'league_manager'].includes(useAuthStore.getState().profile?.role ?? '');
    set(state => ({ players: buildMergedPlayers(priv), loading: state.loading }));
  },

  deletePlayer: async (id) => {
    await deleteDoc(doc(db, 'players', id));
    delete _sensitiveMap[id];
  },

  deletePlayersForTeam: async (teamId) => {
    const batch = writeBatch(db);
    _basePlayers.filter(p => p.teamId === teamId).forEach(p => {
      batch.delete(doc(db, 'players', p.id));
      delete _sensitiveMap[p.id];
    });
    await batch.commit();
  },
}));
