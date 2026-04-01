import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface RsvpEntry {
  uid: string;
  name: string;
  response: 'yes' | 'no';
  updatedAt: string;
}

interface RsvpStore {
  rsvps: Record<string, RsvpEntry[]>;
  submitRsvp: (eventId: string, uid: string, name: string, response: 'yes' | 'no') => Promise<void>;
  subscribeRsvps: (eventId: string) => () => void;
}

export const useRsvpStore = create<RsvpStore>((set) => ({
  rsvps: {},

  submitRsvp: async (eventId, uid, name, response) => {
    const entry: RsvpEntry = { uid, name, response, updatedAt: new Date().toISOString() };
    await setDoc(doc(db, 'events', eventId, 'rsvps', uid), entry);
  },

  subscribeRsvps: (eventId) => {
    const unsub = onSnapshot(
      collection(db, 'events', eventId, 'rsvps'),
      (snap) => {
        const entries = snap.docs.map(d => d.data() as RsvpEntry);
        set(state => ({ rsvps: { ...state.rsvps, [eventId]: entries } }));
      },
      () => {
        // On error, leave existing state in place
      }
    );
    return unsub;
  },
}));
