import { create } from 'zustand';
import type { ScheduledEvent, GameResult } from '@/types';
import { getItem, setItem } from '@/lib/localStorage';
import { STORAGE_KEYS } from '@/constants';

interface EventStore {
  events: ScheduledEvent[];
  addEvent: (event: ScheduledEvent) => void;
  updateEvent: (event: ScheduledEvent) => void;
  deleteEvent: (id: string) => void;
  recordResult: (id: string, result: GameResult) => void;
  bulkAddEvents: (events: ScheduledEvent[]) => void;
}

export const useEventStore = create<EventStore>((set, get) => ({
  events: getItem<ScheduledEvent[]>(STORAGE_KEYS.EVENTS) ?? [],

  addEvent: (event) => {
    const events = [...get().events, event];
    set({ events });
    setItem(STORAGE_KEYS.EVENTS, events);
  },

  updateEvent: (event) => {
    const events = get().events.map(e => e.id === event.id ? event : e);
    set({ events });
    setItem(STORAGE_KEYS.EVENTS, events);
  },

  deleteEvent: (id) => {
    const events = get().events.filter(e => e.id !== id);
    set({ events });
    setItem(STORAGE_KEYS.EVENTS, events);
  },

  recordResult: (id, result) => {
    const now = new Date().toISOString();
    const events = get().events.map(e =>
      e.id === id ? { ...e, result, status: 'completed' as const, updatedAt: now } : e
    );
    set({ events });
    setItem(STORAGE_KEYS.EVENTS, events);
  },

  bulkAddEvents: (newEvents) => {
    const events = [...get().events, ...newEvents];
    set({ events });
    setItem(STORAGE_KEYS.EVENTS, events);
  },
}));
