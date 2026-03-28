import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, updateDoc, query, orderBy, where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthStore } from './useAuthStore';
import type { Venue } from '@/types/venue';

interface VenueStore {
  venues: Venue[];
  loading: boolean;
  subscribe: () => () => void;
  addVenue: (venue: Venue) => Promise<void>;
  updateVenue: (venue: Venue) => Promise<void>;
  softDeleteVenue: (id: string) => Promise<void>;
}

export const useVenueStore = create<VenueStore>((set) => ({
  venues: [],
  loading: true,

  subscribe: () => {
    const uid = useAuthStore.getState().user?.uid;
    if (!uid) {
      set({ venues: [], loading: false });
      return () => {};
    }
    const q = query(
      collection(db, 'users', uid, 'venues'),
      where('deletedAt', '==', null),
      orderBy('createdAt'),
    );
    // Note: Firestore where('deletedAt', '==', null) won't match absent field.
    // Use a real-time listener and filter client-side for absent deletedAt too.
    const unsub = onSnapshot(
      collection(db, 'users', uid, 'venues'),
      (snap) => {
        const venues = snap.docs
          .map(d => ({ ...d.data(), id: d.id }) as Venue)
          .filter(v => !v.deletedAt)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        set({ venues, loading: false });
      },
      () => set({ loading: false }),
    );
    return unsub;
  },

  addVenue: async (venue) => {
    const uid = useAuthStore.getState().user?.uid;
    if (!uid) throw new Error('Not authenticated');
    await setDoc(doc(db, 'users', uid, 'venues', venue.id), venue);
  },

  updateVenue: async (venue) => {
    const uid = useAuthStore.getState().user?.uid;
    if (!uid) throw new Error('Not authenticated');
    await setDoc(doc(db, 'users', uid, 'venues', venue.id), venue);
  },

  softDeleteVenue: async (id) => {
    const uid = useAuthStore.getState().user?.uid;
    if (!uid) throw new Error('Not authenticated');
    await updateDoc(doc(db, 'users', uid, 'venues', id), {
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  },
}));
