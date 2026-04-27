import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy, where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthStore } from '@/store/useAuthStore';
import { todayISO } from '@/lib/dateUtils';
import type { ScheduledEvent, GameResult } from '@/types';

// Statuses readable by any authenticated user without triggering the
// resource.data.status != 'draft' rule guard on unfiltered list queries.
// Draft events are managed in league/season dashboards via separate queries —
// they are intentionally excluded from the global event store.
const NON_DRAFT_STATUSES = ['scheduled', 'completed', 'cancelled', 'postponed'] as const;

interface EventStore {
  events: ScheduledEvent[];
  loading: boolean;
  subscribe: (userTeamIds: string[]) => () => void;
  addEvent: (event: ScheduledEvent) => Promise<void>;
  updateEvent: (event: ScheduledEvent) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  recordResult: (id: string, result: GameResult) => Promise<void>;
  bulkAddEvents: (events: ScheduledEvent[]) => Promise<void>;
  deleteEventsByGroupId: (groupId: string) => Promise<void>;
  updateEventsByGroupId: (groupId: string, patch: Partial<ScheduledEvent>, fromDate?: string) => Promise<void>;
}

export const useEventStore = create<EventStore>((set, get) => ({
  events: [],
  loading: true,

  subscribe: (userTeamIds: string[]) => {
    const profile = useAuthStore.getState().profile;
    const isAdmin = profile?.role === 'admin' || profile?.role === 'league_manager';

    // Non-admin users with no team memberships have nothing to subscribe to.
    // Return a no-op unsubscribe and mark loading done immediately.
    if (!isAdmin && userTeamIds.length === 0) {
      set({ loading: false });
      return () => {};
    }

    // Filter drafts at the query level — makes the query statically satisfiable
    // for all authenticated users (parents/players/coaches/admins). Without this
    // filter, Firestore rejects list queries for users who are not coaches/admins
    // because it cannot statically verify resource.data.status != 'draft'.
    // Draft events are surfaced in the league/season dashboard via separate queries.
    //
    // Non-admin users are also scoped to their own team IDs (up to 30 per Firestore
    // `array-contains-any` limit) to prevent reading every event in the database.
    //
    // Date floor (90 days back): bounds admin reads against unbounded growth — the
    // calendar/home views only need recent + future events. Older completed events
    // are accessible via lazy-load on archive/stats views, not the global subscription.
    const dateFloor = new Date();
    dateFloor.setDate(dateFloor.getDate() - 90);
    const dateFloorIso = dateFloor.toISOString().slice(0, 10);

    const q = isAdmin
      ? query(
          collection(db, 'events'),
          where('status', 'in', [...NON_DRAFT_STATUSES]),
          where('date', '>=', dateFloorIso),
          orderBy('date'),
        )
      : query(
          collection(db, 'events'),
          where('teamIds', 'array-contains-any', userTeamIds.slice(0, 30)),
          where('status', 'in', [...NON_DRAFT_STATUSES]),
          where('date', '>=', dateFloorIso),
          orderBy('date'),
        );

    const unsub = onSnapshot(q, (snap) => {
      const events = snap.docs.map(d => ({ ...d.data(), id: d.id }) as ScheduledEvent);
      set({ events, loading: false });
    }, (err) => {
      console.error('[useEventStore] subscription error:', err);
      set({ loading: false });
    });
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

  deleteEventsByGroupId: async (groupId) => {
    const matching = get().events.filter(e => e.recurringGroupId === groupId);
    await Promise.all(matching.map(e => deleteDoc(doc(db, 'events', e.id))));
  },

  updateEventsByGroupId: async (groupId, patch, fromDate) => {
    const cutoff = fromDate ?? todayISO();
    const matching = get().events.filter(e => e.recurringGroupId === groupId && e.date >= cutoff);
    await Promise.all(matching.map(e => setDoc(doc(db, 'events', e.id), { ...e, ...patch })));
  },
}));
