import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, query, orderBy, where, documentId,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useAuthStore } from '@/store/useAuthStore';
import type { League } from '@/types';

interface LeagueStore {
  leagues: League[];
  loading: boolean;
  subscribe: (userLeagueIds: string[]) => () => void;
  addLeague: (league: League) => Promise<void>;
  updateLeague: (league: League) => Promise<void>;
  deleteLeague: (id: string) => Promise<void>;
}

// Firestore caps `in` queries at 30 values.
const FIRESTORE_IN_QUERY_LIMIT = 30;

export const useLeagueStore = create<LeagueStore>((set) => ({
  leagues: [],
  loading: true,

  subscribe: (userLeagueIds: string[]) => {
    const profile = useAuthStore.getState().profile;
    // Admin + league_manager keep the unscoped global view — admins need to
    // see every league for management; LMs need cross-league visibility for
    // managing teams across the leagues they oversee.
    const isAdminOrLM = profile?.role === 'admin' || profile?.role === 'league_manager';

    // Non-admin/non-LM users with no league memberships have nothing to
    // subscribe to. Return empty + no-op unsub to avoid an unscoped query.
    if (!isAdminOrLM && userLeagueIds.length === 0) {
      set({ leagues: [], loading: false });
      return () => {};
    }

    if (isAdminOrLM) {
      // Server-side filter on isDeleted; defensive client filter as well in
      // case any docs slip through (e.g. legacy docs missing the field).
      const q = query(collection(db, 'leagues'), where('isDeleted', '==', false), orderBy('createdAt'));
      const unsub = onSnapshot(q, (snap) => {
        const leagues = snap.docs
          .map(d => ({ ...d.data(), id: d.id }) as League)
          .filter(l => l.isDeleted !== true);
        set({ leagues, loading: false });
      }, () => set({ loading: false }));
      return unsub;
    }

    // Non-admin path: scope to the user's own league IDs via documentId() `in`
    // filter. Capped at the Firestore IN-query limit. The cap is acceptable
    // because a single user is realistically a member of <30 leagues at our
    // scale; if that ever becomes false we'll need to chunk into multiple
    // listeners and merge.
    const q = query(
      collection(db, 'leagues'),
      where(documentId(), 'in', userLeagueIds.slice(0, FIRESTORE_IN_QUERY_LIMIT)),
    );
    const unsub = onSnapshot(q, (snap) => {
      const leagues = snap.docs
        .map(d => ({ ...d.data(), id: d.id }) as League)
        .filter(l => l.isDeleted !== true);
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
    const fn = httpsCallable<{ leagueId: string }, { success: true }>(functions, 'deleteLeague');
    await fn({ leagueId: id });
  },
}));
