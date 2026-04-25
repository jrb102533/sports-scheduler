import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, query, orderBy, where, updateDoc,
  arrayUnion, arrayRemove, documentId,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useAuthStore } from '@/store/useAuthStore';
import type { Team } from '@/types';

interface TeamStore {
  teams: Team[];         // active (non-deleted) teams
  deletedTeams: Team[];  // soft-deleted teams (admin view)
  loading: boolean;
  subscribe: (userTeamIds: string[]) => () => void;
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

  subscribe: (userTeamIds: string[]) => {
    const isAdmin = useAuthStore.getState().profile?.role === 'admin';

    // Non-admin users with no team memberships have nothing to subscribe to.
    if (!isAdmin && userTeamIds.length === 0) {
      set({ loading: false });
      return () => {};
    }

    // Admin: keep the existing unscoped query (admins need to see all teams).
    // Non-admin: scope to the user's own team IDs via documentId() `in` filter,
    // which avoids the isDeleted inequality index requirement. Deleted teams are
    // not accessible to non-admins so we don't need the deleted-teams listener.
    let unsub: () => void;
    if (isAdmin) {
      // Filter deleted teams server-side so Firestore never sends deleted docs
      // over the wire. Firestore requires orderBy to match the inequality field first.
      const q = query(
        collection(db, 'teams'),
        where('isDeleted', '!=', true),
        orderBy('isDeleted'),
        orderBy('createdAt'),
      );
      unsub = onSnapshot(q, (snap) => {
        set({
          teams: snap.docs.map(d => ({ ...d.data(), id: d.id }) as Team),
          loading: false,
        });
      }, () => set({ loading: false }));
    } else {
      const q = query(
        collection(db, 'teams'),
        where(documentId(), 'in', userTeamIds.slice(0, 30)),
      );
      unsub = onSnapshot(q, (snap) => {
        set({
          teams: snap.docs.map(d => ({ ...d.data(), id: d.id }) as Team),
          loading: false,
        });
      }, () => set({ loading: false }));
    }

    // Open a second listener for deleted teams, scoped to admin users only.
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

  // Admin: permanently remove the document and all subcollections via callable.
  // Uses the server-side hardDeleteTeam Cloud Function so that the Admin SDK's
  // recursiveDelete can remove subcollections (messages, availability) that the
  // client SDK cannot reach.
  hardDeleteTeam: async (id) => {
    const fn = httpsCallable<{ teamId: string }, { success: boolean }>(functions, 'hardDeleteTeam');
    await fn({ teamId: id });
  },

  // Legacy alias — delegates to hardDeleteTeam callable for subcollection safety.
  deleteTeam: async (id) => {
    const fn = httpsCallable<{ teamId: string }, { success: boolean }>(functions, 'hardDeleteTeam');
    await fn({ teamId: id });
  },
}));
