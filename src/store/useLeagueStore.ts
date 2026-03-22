import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { League } from '@/types';

interface LeagueStore {
  leagues: League[];
  loading: boolean;
  subscribe: () => () => void;
  addLeague: (league: League) => Promise<void>;
  updateLeague: (league: League) => Promise<void>;
  deleteLeague: (id: string) => Promise<void>;
}

export const useLeagueStore = create<LeagueStore>((set) => ({
  leagues: [],
  loading: true,

  subscribe: () => {
    const q = query(collection(db, 'leagues'), orderBy('createdAt'));
    const unsub = onSnapshot(q, (snap) => {
      const leagues = snap.docs.map(d => ({ ...d.data(), id: d.id }) as League);
      set({ leagues, loading: false });
    }, () => set({ loading: false }));
    return unsub;
  },

  addLeague: async (league) => {
    await setDoc(doc(db, 'leagues', league.id), league);
  },

  updateLeague: async (league) => {
    await setDoc(doc(db, 'leagues', league.id), league);
  },

  deleteLeague: async (id) => {
    await deleteDoc(doc(db, 'leagues', id));
  },
}));
