import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy, where, updateDoc,
  arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthStore } from '@/store/useAuthStore';
import type { Team } from '@/types';

interface TeamStore {
  teams: Team[];         // active (non-deleted) teams
  deletedTeams: Team[];  // soft-deleted teams (admin view)
  loading: boolean;
  subscribe: () => () => void;
  updateTeam: (team: Team) => Promise<void>;
  addTeamToLeague: (teamId: string, leagueId: string) => Promise<void>;
  removeTeamFromLeague: (teamId: string, leagueId: string) => Promise<void>;
  softDeleteTeam: (id: string) => Promise<void>;
  restoreTeam: (id: string) => Promise<void>;
  hardDeleteTeam: (id: string) => Promise<void>;
  /** @deprecated use softDeleteTeam or hardDeleteTeam */
  deleteTeam: (id: string) => Promise<void>;
}

export const useTeamStore = create<TeamStore>((set) => ({
  teams: [],
  deletedTeams: [],
  loading: true,

  subscribe: () => {
    // Filter deleted teams server-side so Firestore never sends deleted docs
    // over the wire. Firestore requires orderBy to match the inequality field first.
    const q = query(
      collection(db, 'teams'),
      where('isDeleted', '!=', true),
      orderBy('isDeleted'),
      orderBy('createdAt'),
    );
    const unsub = onSnapshot(q, (snap) => {
      set({
        teams: snap.docs.map(d => ({ ...d.data(), id: d.id }) as Team),
        loading: false,
      });
    }, () => set({ loading: false }));

    // Open a second listener for deleted teams, scoped to admin users only.
    const isAdmin = useAuthStore.getState().profile?.role === 'admin';
    let unsubDeleted: (() => void) | undefined;
    if (isAdmin) {
      const qDeleted = query(
        collection(db, 'teams'),
        where('isDeleted', '==', true),
        orderBy('deletedAt', 'desc'),
      );
      unsubDeleted = onSnapshot(qDeleted, (snap) => {
        set({ deletedTeams: snap.docs.map(d => ({ ...d.data(), id: d.id }) as Team) });
      }, (err) => console.error('[useTeamStore] deleted teams listener error:', err));
    }

    return () => { unsub(); if (unsubDeleted) unsubDeleted(); };
  },

  updateTeam: async (team) => {
    const data = Object.fromEntries(Object.entries(team).filter(([, v]) => v !== undefined));
    await setDoc(doc(db, 'teams', team.id), data);
  },

  addTeamToLeague: async (teamId, leagueId) => {
    await updateDoc(doc(db, 'teams', teamId), {
      leagueIds: arrayUnion(leagueId),
      _managedLeagueId: leagueId,
    });
  },

  removeTeamFromLeague: async (teamId, leagueId) => {
    await updateDoc(doc(db, 'teams', teamId), {
      leagueIds: arrayRemove(leagueId),
      _managedLeagueId: leagueId,
    });
  },

  // Owner-initiated delete: marks as deleted, recoverable by admin
  softDeleteTeam: async (id) => {
    await updateDoc(doc(db, 'teams', id), {
      isDeleted: true,
      deletedAt: new Date().toISOString(),
    });
  },

  // Admin: undo a soft delete
  restoreTeam: async (id) => {
    await updateDoc(doc(db, 'teams', id), {
      isDeleted: false,
      deletedAt: null,
    });
  },

  // Admin: permanently remove the document
  hardDeleteTeam: async (id) => {
    await deleteDoc(doc(db, 'teams', id));
  },

  // Legacy alias — hard delete
  deleteTeam: async (id) => {
    await deleteDoc(doc(db, 'teams', id));
  },
}));
