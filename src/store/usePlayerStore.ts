import { create } from 'zustand';
import {
  collection, collectionGroup, onSnapshot, doc, setDoc, deleteDoc,
  query, orderBy, writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthStore } from './useAuthStore';
import type { Player, SensitivePlayerData } from '@/types';

// Module-level caches — shared across the singleton store instance.
// Updated by onSnapshot callbacks and merged before storing in Zustand state.
let _basePlayers: Player[] = [];
let _sensitiveMap: Record<string, SensitivePlayerData> = {};

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
    const profile = useAuthStore.getState().profile;
    const isPrivileged = ['admin', 'coach', 'league_manager'].includes(profile?.role ?? '');

    // ── Main player docs ───────────────────────────────────────────────────────
    const playerUnsub = onSnapshot(
      query(collection(db, 'players'), orderBy('createdAt')),
      (snap) => {
        const currentProfile = useAuthStore.getState().profile;
        const priv = ['admin', 'coach', 'league_manager'].includes(currentProfile?.role ?? '');
        _basePlayers = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Player);
        set({ players: buildMergedPlayers(priv), loading: false });
      },
      () => set({ loading: false }),
    );

    if (!isPrivileged) return playerUnsub;

    // ── Sensitive PII subcollection (coach/admin only) ─────────────────────────
    // Subscribes to all sensitiveData docs across all players. Firestore rules
    // restrict this to isAdmin() || isCoach() so non-privileged clients
    // will never receive these documents even if they query the group.
    const sensitiveUnsub = onSnapshot(
      collectionGroup(db, 'sensitiveData'),
      (snap) => {
        snap.docs.forEach(d => {
          const data = d.data() as SensitivePlayerData;
          if (data.playerId) _sensitiveMap[data.playerId] = data;
        });
        const currentProfile = useAuthStore.getState().profile;
        const priv = ['admin', 'coach', 'league_manager'].includes(currentProfile?.role ?? '');
        set(state => ({ players: buildMergedPlayers(priv), loading: state.loading }));
      },
    );

    return () => {
      playerUnsub();
      sensitiveUnsub();
    };
  },

  addPlayer: async (player) => {
    // Write only non-sensitive fields to the main player doc.
    const { dateOfBirth, parentContact, parentContact2, emergencyContact, ...mainFields } = player;
    await setDoc(doc(db, 'players', player.id), mainFields);
  },

  addSensitiveData: async (playerId, teamId, data) => {
    const docData: SensitivePlayerData = { playerId, teamId, ...data };
    await setDoc(doc(db, 'players', playerId, 'sensitiveData', 'private'), docData);
    _sensitiveMap[playerId] = docData;
  },

  updatePlayer: async (player) => {
    const { dateOfBirth, parentContact, parentContact2, emergencyContact, ...mainFields } = player;
    await setDoc(doc(db, 'players', player.id), mainFields);
  },

  updateSensitiveData: async (playerId, teamId, data) => {
    const existing = _sensitiveMap[playerId] ?? { playerId, teamId };
    const updated: SensitivePlayerData = { ...existing, ...data, playerId, teamId };
    await setDoc(doc(db, 'players', playerId, 'sensitiveData', 'private'), updated);
    _sensitiveMap[playerId] = updated;
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
