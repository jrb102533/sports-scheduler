import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { ScheduledEvent, GameResult } from '@/types';

interface EventStore {
  events: ScheduledEvent[];
  loading: boolean;
  subscribe: () => () => void;
  addEvent: (event: ScheduledEvent) => Promise<void>;
  updateEvent: (event: ScheduledEvent) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  recordResult: (id: string, result: GameResult) => Promise<void>;
  bulkAddEvents: (events: ScheduledEvent[]) => Promise<void>;
}

export const useEventStore = create<EventStore>((set, get) => ({
  events: [],
  loading: true,

  subscribe: () => {
    const q = query(collection(db, 'events'), orderBy('date'));
    const unsub = onSnapshot(q, (snap) => {
      const events = snap.docs.map(d => ({ ...d.data(), id: d.id }) as ScheduledEvent);
      set({ events, loading: false });
    }, () => set({ loading: false }));
    return unsub;
  },

  addEvent: async (event) => {
    await setDoc(doc(db, 'events', event.id), event);
  },

  updateEvent: async (event) => {
    await setDoc(doc(db, 'events', event.id), event);
  },

  deleteEvent: async (id) => {
    await deleteDoc(doc(db, 'events', id));
  },

  recordResult: async (id, result) => {
    const event = get().events.find(e => e.id === id);
    if (!event) return;
    await setDoc(doc(db, 'events', id), {
      ...event,
      result,
      status: 'completed',
      updatedAt: new Date().toISOString(),
    });
  },

  bulkAddEvents: async (newEvents) => {
    await Promise.all(newEvents.map(e => setDoc(doc(db, 'events', e.id), e)));
  },
}));
