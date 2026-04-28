import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, query, orderBy, where, updateDoc,
  arrayUnion, arrayRemove, documentId,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useAuthStore } from '@/store/useAuthStore';
import type { UserProfile, Team } from '@/types';

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

// ── Pure helper: decides which listener variant to open ───────────────────────
//
// Returns a stable descriptor string — same inputs, same string. Used to detect
// whether the auth state change is actually relevant (avoids listener churn on
// unrelated token refreshes or field updates).

export function buildTeamListenerDescriptor(
  role: string | undefined,
  teamIds: string[],
): string {
  const isAdmin = role === 'admin' || role === 'league_manager';
  if (isAdmin) return 'admin';
  if (teamIds.length === 0) return 'none';
  return `member:${teamIds.slice(0, 30).sort().join(',')}`;
}

// ── Internal listener opener ──────────────────────────────────────────────────

function openTeamListeners(
  set: (partial: Partial<{ teams: Team[]; deletedTeams: Team[]; loading: boolean }>) => void,
  role: string | undefined,
  userTeamIds: string[],
): (() => void) {
  const isAdmin = role === 'admin' || role === 'league_manager';

  // Guard: non-admin users with no memberships have nothing to subscribe to.
  // Return immediately with loading:false and empty teams — never issue the
  // malformed where(documentId(), 'in', []) query that hangs forever.
  if (!isAdmin && userTeamIds.length === 0) {
    set({ teams: [], loading: false });
    return () => {};
  }

  let unsub: () => void;
  if (isAdmin) {
    // Admin: unscoped query — admins need to see all teams.
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
    // Non-admin: scope to the user's own team IDs via documentId() `in` filter.
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
}

// ── Helper: extract role and sorted teamIds from a profile ────────────────────

function profileToDescriptor(profile: UserProfile | null, fallbackTeamIds: string[]): {
  role: string | undefined;
  teamIds: string[];
} {
  if (!profile) {
    return { role: undefined, teamIds: fallbackTeamIds };
  }
  const role = profile.role;
  const isAdmin = role === 'admin' || role === 'league_manager';
  if (isAdmin) return { role, teamIds: [] };
  // Derive team IDs from memberships (profile is the authoritative source post-load).
  const ids = new Set<string>();
  for (const m of profile.memberships ?? []) {
    if (m.teamId) ids.add(m.teamId);
  }
  // Fallback to caller-supplied teamIds in case memberships field is absent.
  if (ids.size === 0) {
    for (const id of fallbackTeamIds) ids.add(id);
  }
  return { role, teamIds: [...ids] };
}

export const useTeamStore = create<TeamStore>((set) => ({
  teams: [],
  deletedTeams: [],
  loading: true,

  // subscribe() is intentionally reactive: it opens the correct Firestore
  // listener immediately, but also watches useAuthStore for profile changes.
  // This handles the auth race window where user is set but profile (loaded via
  // a separate onSnapshot) is still null when subscribe() is first called.
  //
  // Without reactivity:
  //   - profile null → isAdmin false → empty userTeamIds → malformed
  //     where(documentId(), 'in', []) query → loading hangs forever
  //
  // With reactivity:
  //   - profile null → no-op / empty guard → loading: false, teams: []
  //   - profile arrives → auth watcher fires → correct listener opens
  //
  // The consumer (MainLayout) continues to call subscribe(userTeamIds) once
  // and gets back a single teardown. The reactive re-subscription is internal.
  subscribe: (userTeamIds: string[]) => {
    const getProfile = () => useAuthStore.getState().profile;

    // Open initial listeners based on current profile state.
    const initial = profileToDescriptor(getProfile(), userTeamIds);
    let currentDescriptor = buildTeamListenerDescriptor(initial.role, initial.teamIds);
    let teardownListeners = openTeamListeners(set, initial.role, initial.teamIds);

    // Watch for profile changes (role arrival, memberships update).
    // A signature string prevents listener churn on unrelated auth-store
    // changes (token refresh, consent field, etc.).
    const authUnsub = useAuthStore.subscribe((state) => {
      const next = profileToDescriptor(state.profile, userTeamIds);
      const nextDescriptor = buildTeamListenerDescriptor(next.role, next.teamIds);
      if (nextDescriptor === currentDescriptor) return;

      // Descriptor changed → tear down old listeners and open new ones.
      teardownListeners();
      currentDescriptor = nextDescriptor;
      teardownListeners = openTeamListeners(set, next.role, next.teamIds);
    });

    return () => {
      teardownListeners();
      authUnsub();
    };
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
