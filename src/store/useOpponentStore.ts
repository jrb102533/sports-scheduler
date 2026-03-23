import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Opponent } from '@/types';

interface OpponentStore {
  opponents: Opponent[];
  loading: boolean;
  subscribe: () => () => void;
  addOpponent: (opponent: Opponent) => Promise<void>;
  updateOpponent: (opponent: Opponent) => Promise<void>;
  deleteOpponent: (id: string) => Promise<void>;
}

export const useOpponentStore = create<OpponentStore>((set) => ({
  opponents: [],
  loading: true,

  subscribe: () => {
    const q = query(collection(db, 'opponents'), orderBy('createdAt'));
    const unsub = onSnapshot(q, (snap) => {
      const opponents = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Opponent);
      set({ opponents, loading: false });
    }, () => set({ loading: false }));
    return unsub;
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
