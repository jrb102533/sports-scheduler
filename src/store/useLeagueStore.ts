import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy, updateDoc,
  arrayRemove,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useTeamStore } from './useTeamStore';
import { useEventStore } from './useEventStore';
import type { League } from '@/types';

interface LeagueStore {
  leagues: League[];
  loading: boolean;
  subscribe: () => () => void;
  addLeague: (league: League) => Promise<void>;
  updateLeague: (league: League) => Promise<void>;
  deleteLeague: (id: string) => Promise<void>;
  softDeleteLeague: (id: string) => Promise<void>;
}

export const useLeagueStore = create<LeagueStore>((set) => ({
  leagues: [],
  loading: true,

  subscribe: () => {
    const q = query(collection(db, 'leagues'), orderBy('createdAt'));
    const unsub = onSnapshot(q, (snap) => {
      const leagues = snap.docs
        .map(d => ({ ...d.data(), id: d.id }) as League)
        .filter(l => !l.isDeleted);
      set({ leagues, loading: false });
    }, () => set({ loading: false }));
    return unsub;
  },

  addLeague: async (league) => {
    await setDoc(doc(db, 'leagues', league.id), league);
  },

  updateLeague: async (league) => {
    await setDoc(doc(db, 'leagues', league.id), league);
  },

  deleteLeague: async (id) => {
    await deleteDoc(doc(db, 'leagues', id));
  },

  softDeleteLeague: async (id) => {
    // 1. Remove leagueId from all associated teams
    const teams = useTeamStore.getState().teams;
    const leagueTeams = teams.filter(t => t.leagueIds?.includes(id));
    await Promise.all(
      leagueTeams.map(t => updateDoc(doc(db, 'teams', t.id), { leagueIds: arrayRemove(id) }))
    );

    // 2. Delete events whose teams were exclusively in this league
    const events = useEventStore.getState().events;
    const leagueTeamIds = new Set(leagueTeams.map(t => t.id));
    const leagueEvents = events.filter(e =>
      e.teamIds.length > 0 && e.teamIds.every(tid => leagueTeamIds.has(tid))
    );
    await Promise.all(
      leagueEvents.map(e => deleteDoc(doc(db, 'events', e.id)))
    );

    // 3. Soft-delete the league itself
    await updateDoc(doc(db, 'leagues', id), {
      isDeleted: true,
      deletedAt: new Date().toISOString(),
    });
  },
}));
