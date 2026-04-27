import { create } from 'zustand';
import {
  collection, onSnapshot, getDocs,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';

export interface RsvpEntry {
  uid: string;
  playerId?: string;
  name: string;
  response: 'yes' | 'no' | 'maybe';
  updatedAt: string;
}

interface RsvpStore {
  rsvps: Record<string, RsvpEntry[]>;
  submitRsvp: (eventId: string, uid: string, name: string, response: 'yes' | 'no' | 'maybe', playerId?: string) => Promise<void>;
  subscribeRsvps: (eventId: string) => () => void;
  /** One-shot fetch for an event's rsvps subcollection. No-ops if already loaded. */
  loadForEvent: (eventId: string) => Promise<void>;
}

export const useRsvpStore = create<RsvpStore>((set) => ({
  rsvps: {},

  submitRsvp: async (eventId: string, _uid: string, name: string, response: 'yes' | 'no' | 'maybe', playerId?: string) => {
    // SEC-99: direct Firestore writes are blocked by `allow write: if false`.
    // All RSVP writes go through the submitRsvp Cloud Function so the server
    // can validate playerId ownership before writing.
    const fn = httpsCallable<
      { eventId: string; name: string; response: string; playerId?: string },
      { success: true }
    >(functions, 'submitRsvp');

    await fn({ eventId, name, response, ...(playerId ? { playerId } : {}) });
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

  loadForEvent: async (eventId) => {
    // No-op if already populated by subscribeRsvps or a previous loadForEvent call
    const existing = useRsvpStore.getState().rsvps[eventId];
    if (existing !== undefined) return;

    try {
      const snap = await getDocs(collection(db, 'events', eventId, 'rsvps'));
      const entries = snap.docs.map(d => d.data() as RsvpEntry);
      set(state => ({ rsvps: { ...state.rsvps, [eventId]: entries } }));
    } catch {
      // On error, leave state unchanged — component degrades gracefully
    }
  },
}));
