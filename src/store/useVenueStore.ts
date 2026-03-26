import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, deleteDoc, query, where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Venue } from '@/types';

interface VenueStore {
  venues: Venue[];
  loading: boolean;
  subscribe: (leagueId: string) => () => void;
  addVenue: (venue: Venue) => Promise<void>;
  updateVenue: (venue: Venue) => Promise<void>;
  deleteVenue: (id: string) => Promise<void>;
}

export const useVenueStore = create<VenueStore>((set) => ({
  venues: [],
  loading: true,

  subscribe: (leagueId: string) => {
    const q = query(collection(db, 'venues'), where('leagueId', '==', leagueId));
    const unsub = onSnapshot(q, (snap) => {
      const venues = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Venue);
      set({ venues, loading: false });
    }, () => set({ loading: false }));
    return unsub;
  },

  addVenue: async (venue) => {
    await setDoc(doc(db, 'venues', venue.id), venue);
  },

  updateVenue: async (venue) => {
    await setDoc(doc(db, 'venues', venue.id), venue);
  },

  deleteVenue: async (id) => {
    await deleteDoc(doc(db, 'venues', id));
  },
}));
