import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, query, where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { LeagueSchedule } from '@/types';

interface ScheduleStore {
  schedules: LeagueSchedule[];
  loading: boolean;
  subscribe: (leagueId: string) => () => void;
  saveSchedule: (schedule: LeagueSchedule) => Promise<void>;
}

export const useScheduleStore = create<ScheduleStore>((set) => ({
  schedules: [],
  loading: true,

  subscribe: (leagueId: string) => {
    const q = query(collection(db, 'leagueSchedules'), where('leagueId', '==', leagueId));
    const unsub = onSnapshot(q, (snap) => {
      const schedules = snap.docs.map(d => ({ ...d.data(), id: d.id }) as LeagueSchedule);
      set({ schedules, loading: false });
    }, () => set({ loading: false }));
    return unsub;
  },

  saveSchedule: async (schedule) => {
    await setDoc(doc(db, 'leagueSchedules', schedule.id), schedule);
  },
}));
