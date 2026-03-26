import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, query, where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { LeagueAvailabilityRequest, CoachAvailability } from '@/types';

interface CoachAvailabilityStore {
  requests: LeagueAvailabilityRequest[];
  submissions: CoachAvailability[];
  loading: boolean;
  subscribeRequests: (leagueId: string) => () => void;
  subscribeSubmissions: (leagueId: string) => () => void;
  addRequest: (req: LeagueAvailabilityRequest) => Promise<void>;
  updateRequest: (req: LeagueAvailabilityRequest) => Promise<void>;
  saveSubmission: (sub: CoachAvailability) => Promise<void>;
}

export const useCoachAvailabilityStore = create<CoachAvailabilityStore>((set) => ({
  requests: [],
  submissions: [],
  loading: true,

  subscribeRequests: (leagueId: string) => {
    const q = query(collection(db, 'leagueAvailabilityRequests'), where('leagueId', '==', leagueId));
    const unsub = onSnapshot(q, (snap) => {
      const requests = snap.docs.map(d => ({ ...d.data(), id: d.id }) as LeagueAvailabilityRequest);
      set({ requests, loading: false });
    }, () => set({ loading: false }));
    return unsub;
  },

  subscribeSubmissions: (leagueId: string) => {
    const q = query(collection(db, 'coachAvailability'), where('leagueId', '==', leagueId));
    const unsub = onSnapshot(q, (snap) => {
      const submissions = snap.docs.map(d => ({ ...d.data(), id: d.id }) as CoachAvailability);
      set({ submissions });
    });
    return unsub;
  },

  addRequest: async (req) => {
    await setDoc(doc(db, 'leagueAvailabilityRequests', req.id), req);
  },

  updateRequest: async (req) => {
    await setDoc(doc(db, 'leagueAvailabilityRequests', req.id), req);
  },

  saveSubmission: async (sub) => {
    await setDoc(doc(db, 'coachAvailability', sub.id), sub);
  },
}));
