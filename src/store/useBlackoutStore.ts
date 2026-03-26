import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, deleteDoc, query, where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { LeagueBlackout } from '@/types';

interface BlackoutStore {
  blackouts: LeagueBlackout[];
  loading: boolean;
  subscribe: (leagueId: string) => () => void;
  addBlackout: (blackout: LeagueBlackout) => Promise<void>;
  deleteBlackout: (id: string) => Promise<void>;
}

export const useBlackoutStore = create<BlackoutStore>((set) => ({
  blackouts: [],
  loading: true,

  subscribe: (leagueId: string) => {
    const q = query(collection(db, 'leagueBlackouts'), where('leagueId', '==', leagueId));
    const unsub = onSnapshot(q, (snap) => {
      const blackouts = snap.docs.map(d => ({ ...d.data(), id: d.id }) as LeagueBlackout);
      set({ blackouts: blackouts.sort((a, b) => a.startDate.localeCompare(b.startDate)), loading: false });
    }, () => set({ loading: false }));
    return unsub;
  },

  addBlackout: async (blackout) => {
    await setDoc(doc(db, 'leagueBlackouts', blackout.id), blackout);
  },

  deleteBlackout: async (id) => {
    await deleteDoc(doc(db, 'leagueBlackouts', id));
  },
}));
