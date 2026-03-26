import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy, writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthStore } from './useAuthStore';
import type { Player } from '@/types';

interface PlayerStore {
  players: Player[];
  loading: boolean;
  subscribe: () => () => void;
  addPlayer: (player: Player) => Promise<void>;
  updatePlayer: (player: Player) => Promise<void>;
  deletePlayer: (id: string) => Promise<void>;
  deletePlayersForTeam: (teamId: string) => Promise<void>;
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  players: [],
  loading: true,

  subscribe: () => {
    const q = query(collection(db, 'players'), orderBy('createdAt'));
    const unsub = onSnapshot(q, (snap) => {
      const profile = useAuthStore.getState().profile;
      const isPrivileged = ['admin', 'coach', 'league_manager'].includes(profile?.role ?? '');
      const players = snap.docs.map(d => {
        const data = { ...d.data(), id: d.id } as Player;
        // statusNote is a private coach-only field. Firestore rules cannot project
        // individual fields, so we strip it here for all non-privileged users.
        if (!isPrivileged) {
          delete (data as Partial<Player>).statusNote;
        }
        return data;
      });
      set({ players, loading: false });
    }, () => set({ loading: false }));
    return unsub;
  },

  addPlayer: async (player) => {
    await setDoc(doc(db, 'players', player.id), player);
  },

  updatePlayer: async (player) => {
    await setDoc(doc(db, 'players', player.id), player);
  },

  deletePlayer: async (id) => {
    await deleteDoc(doc(db, 'players', id));
  },

  deletePlayersForTeam: async (teamId) => {
    const batch = writeBatch(db);
    get().players.filter(p => p.teamId === teamId).forEach(p => {
      batch.delete(doc(db, 'players', p.id));
    });
    await batch.commit();
  },
}));
