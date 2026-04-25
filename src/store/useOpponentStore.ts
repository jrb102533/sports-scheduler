import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy, where, getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Opponent } from '@/types';

interface OpponentStore {
  opponents: Opponent[];
  loading: boolean;
  subscribe: (userTeamIds: string[]) => () => void;
  /** Lazy one-shot fetch scoped to the given team IDs. Used by EventForm on open. */
  fetchForTeams: (teamIds: string[]) => Promise<void>;
  addOpponent: (opponent: Opponent) => Promise<void>;
  updateOpponent: (opponent: Opponent) => Promise<void>;
  deleteOpponent: (id: string) => Promise<void>;
}

export const useOpponentStore = create<OpponentStore>((set) => ({
  opponents: [],
  loading: true,

  subscribe: (userTeamIds: string[]) => {
    // Admins without team memberships see no opponents — avoids global scan.
    if (userTeamIds.length === 0) {
      set({ loading: false });
      return () => {};
    }

    // Scope to the user's teams for all roles (including admins).
    // Admins' userTeamIds is populated from their memberships, same as other users.
    const q = query(
      collection(db, 'opponents'),
      where('teamId', 'in', userTeamIds.slice(0, 30)),
      orderBy('createdAt'),
    );

    const unsub = onSnapshot(q, (snap) => {
      const opponents = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Opponent);
      set({ opponents, loading: false });
    }, () => set({ loading: false }));
    return unsub;
  },

  fetchForTeams: async (teamIds: string[]) => {
    if (teamIds.length === 0) { set({ loading: false }); return; }
    set({ loading: true });
    try {
      const q = query(
        collection(db, 'opponents'),
        where('teamId', 'in', teamIds.slice(0, 30)),
        orderBy('createdAt'),
      );
      const snap = await getDocs(q);
      set({ opponents: snap.docs.map(d => ({ ...d.data(), id: d.id }) as Opponent), loading: false });
    } catch (err) {
      console.error('[useOpponentStore] fetchForTeams error:', err);
      set({ loading: false });
    }
  },

  addOpponent: async (opponent) => {
    await setDoc(doc(db, 'opponents', opponent.id), opponent);
  },

  updateOpponent: async (opponent) => {
    await setDoc(doc(db, 'opponents', opponent.id), opponent);
  },

  deleteOpponent: async (id) => {
    await deleteDoc(doc(db, 'opponents', id));
  },
}));
