import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Team } from '@/types';

interface TeamStore {
  teams: Team[];
  loading: boolean;
  subscribe: () => () => void;
  addTeam: (team: Team) => Promise<void>;
  updateTeam: (team: Team) => Promise<void>;
  deleteTeam: (id: string) => Promise<void>;
}

export const useTeamStore = create<TeamStore>((set) => ({
  teams: [],
  loading: true,

  subscribe: () => {
    const q = query(collection(db, 'teams'), orderBy('createdAt'));
    const unsub = onSnapshot(q, (snap) => {
      const teams = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Team);
      set({ teams, loading: false });
    }, () => set({ loading: false }));
    return unsub;
  },

  addTeam: async (team) => {
    await setDoc(doc(db, 'teams', team.id), team);
  },

  updateTeam: async (team) => {
    await setDoc(doc(db, 'teams', team.id), team);
  },

  deleteTeam: async (id) => {
    await deleteDoc(doc(db, 'teams', id));
  },
}));
