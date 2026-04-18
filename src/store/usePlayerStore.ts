import { create } from 'zustand';
import {
  collection, collectionGroup, onSnapshot, doc, setDoc, deleteDoc,
  query, orderBy, where, writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthStore, getMemberships } from './useAuthStore';
import type { Player, SensitivePlayerData, UserProfile } from '@/types';

// Module-level caches — shared across the singleton store instance.
// Players are partitioned by teamId so we can add/remove per-team listeners
// independently as the user's memberships change.
const _playersByTeam: Record<string, Player[]> = {};
let _adminPlayers: Player[] | null = null;
const _sensitiveMap: Record<string, SensitivePlayerData> = {};

function flattenPlayers(useAdminCache: boolean): Player[] {
  if (useAdminCache && _adminPlayers) return _adminPlayers;
  const seen = new Set<string>();
  const out: Player[] = [];
  for (const arr of Object.values(_playersByTeam)) {
    for (const p of arr) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

function buildMergedPlayers(isPrivileged: boolean, useAdminCache: boolean): Player[] {
  const base = flattenPlayers(useAdminCache);
  return base.map(p => {
    if (!isPrivileged) {
      const safe = { ...p };
      delete (safe as Partial<Player>).statusNote;
      return safe;
    }
    const sensitive = _sensitiveMap[p.id];
    return sensitive ? { ...p, ...sensitive } : p;
  });
}

function extractTeamIds(profile: UserProfile | null): string[] {
  if (!profile) return [];
  const set = new Set<string>();
  for (const m of getMemberships(profile)) {
    if (m.teamId) set.add(m.teamId);
  }
  if (profile.teamId) set.add(profile.teamId);
  return [...set];
}

interface PlayerStore {
  players: Player[];
  loading: boolean;
  subscribe: () => () => void;
  addPlayer: (player: Player) => Promise<void>;
  addSensitiveData: (playerId: string, teamId: string, data: Partial<SensitivePlayerData>) => Promise<void>;
  updatePlayer: (player: Player) => Promise<void>;
  updateSensitiveData: (playerId: string, teamId: string, data: Partial<SensitivePlayerData>) => Promise<void>;
  deletePlayer: (id: string) => Promise<void>;
  deletePlayersForTeam: (teamId: string) => Promise<void>;
}

export const usePlayerStore = create<PlayerStore>((set) => ({
  players: [],
  loading: true,

  // Subscribes to the players the current user can see. Uses a fan-out pattern:
  // one onSnapshot listener per teamId the user has membership in. This scales
  // to any number of teams (no Firestore `in`-query 30-cap) and reconciles
  // automatically as memberships change. Admins use an unfiltered query since
  // rules allow it and a per-team fan-out would be wasteful at platform scale.
  subscribe: () => {
    const teamListeners: Record<string, () => void> = {};
    const sensitiveListeners: Record<string, () => void> = {};
    let adminUnsub: (() => void) | null = null;
    let adminSensitiveUnsub: (() => void) | null = null;

    const getProfile = () => useAuthStore.getState().profile;
    const isAdminRole = () => getProfile()?.role === 'admin';
    const isPrivileged = () =>
      ['admin', 'coach', 'league_manager'].includes(getProfile()?.role ?? '');

    function publish() {
      set({
        players: buildMergedPlayers(isPrivileged(), isAdminRole()),
        loading: false,
      });
    }

    function subscribeTeam(teamId: string) {
      if (teamListeners[teamId]) return;
      const q = query(
        collection(db, 'players'),
        where('teamId', '==', teamId),
        orderBy('createdAt'),
      );
      teamListeners[teamId] = onSnapshot(
        q,
        (snap) => {
          _playersByTeam[teamId] = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Player);
          publish();
        },
        (err) => {
          console.error(`[usePlayerStore] player subscription error (team=${teamId}):`, err);
        },
      );
    }

    function unsubscribeTeam(teamId: string) {
      teamListeners[teamId]?.();
      delete teamListeners[teamId];
      delete _playersByTeam[teamId];
    }

    function subscribeSensitive(teamId: string) {
      if (sensitiveListeners[teamId]) return;
      const q = query(
        collectionGroup(db, 'sensitiveData'),
        where('teamId', '==', teamId),
      );
      sensitiveListeners[teamId] = onSnapshot(
        q,
        (snap) => {
          snap.docs.forEach(d => {
            const data = d.data() as SensitivePlayerData;
            if (data.playerId) _sensitiveMap[data.playerId] = data;
          });
          publish();
        },
        (err) => {
          if (err.code !== 'permission-denied') {
            console.error(
              `[usePlayerStore] sensitive subscription error (team=${teamId}):`,
              err,
            );
          }
        },
      );
    }

    function unsubscribeSensitive(teamId: string) {
      sensitiveListeners[teamId]?.();
      delete sensitiveListeners[teamId];
    }

    function teardownNonAdmin() {
      for (const id of Object.keys(teamListeners)) unsubscribeTeam(id);
      for (const id of Object.keys(sensitiveListeners)) unsubscribeSensitive(id);
    }

    function teardownAdmin() {
      adminUnsub?.();
      adminUnsub = null;
      adminSensitiveUnsub?.();
      adminSensitiveUnsub = null;
      _adminPlayers = null;
    }

    function reconcile() {
      const profile = getProfile();
      if (!profile) {
        teardownNonAdmin();
        teardownAdmin();
        set({ players: [], loading: false });
        return;
      }

      if (profile.role === 'admin') {
        teardownNonAdmin();
        if (!adminUnsub) {
          const q = query(collection(db, 'players'), orderBy('createdAt'));
          adminUnsub = onSnapshot(
            q,
            (snap) => {
              _adminPlayers = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Player);
              publish();
            },
            (err) => {
              console.error('[usePlayerStore] admin player subscription error:', err);
            },
          );
        }
        if (!adminSensitiveUnsub) {
          adminSensitiveUnsub = onSnapshot(
            collectionGroup(db, 'sensitiveData'),
            (snap) => {
              snap.docs.forEach(d => {
                const data = d.data() as SensitivePlayerData;
                if (data.playerId) _sensitiveMap[data.playerId] = data;
              });
              publish();
            },
            (err) => {
              if (err.code !== 'permission-denied') {
                console.error('[usePlayerStore] admin sensitive subscription error:', err);
              }
            },
          );
        }
        return;
      }

      // Non-admin: fan-out listeners across every team the user has membership in.
      teardownAdmin();
      const wanted = new Set(extractTeamIds(profile));

      for (const id of Object.keys(teamListeners)) {
        if (!wanted.has(id)) unsubscribeTeam(id);
      }
      for (const id of Object.keys(sensitiveListeners)) {
        if (!wanted.has(id)) unsubscribeSensitive(id);
      }

      for (const id of wanted) {
        subscribeTeam(id);
        subscribeSensitive(id);
      }

      if (wanted.size === 0) {
        set({ players: [], loading: false });
      }
    }

    reconcile();

    // Re-reconcile whenever the profile's role or set of teamIds changes.
    // A signature string lets us ignore unrelated auth-store changes (token
    // refresh, unrelated field updates) that would otherwise churn listeners.
    const computeSignature = (p: UserProfile | null) => {
      if (!p) return '';
      const ids = extractTeamIds(p).sort().join(',');
      return `${p.role}|${ids}`;
    };
    let lastSignature = computeSignature(getProfile());
    const authUnsub = useAuthStore.subscribe((state) => {
      const sig = computeSignature(state.profile);
      if (sig !== lastSignature) {
        lastSignature = sig;
        reconcile();
      }
    });

    return () => {
      teardownNonAdmin();
      teardownAdmin();
      authUnsub();
    };
  },

  addPlayer: async (player) => {
    // Write only non-sensitive fields to the main player doc.
    const { dateOfBirth: _dob, parentContact: _pc, parentContact2: _pc2, emergencyContact: _ec, ...mainFields } = player;
    await setDoc(doc(db, 'players', player.id), mainFields);
  },

  addSensitiveData: async (playerId, teamId, data) => {
    const docData: SensitivePlayerData = { playerId, teamId, ...data };
    await setDoc(doc(db, 'players', playerId, 'sensitiveData', 'private'), docData);
    _sensitiveMap[playerId] = docData;
    const priv = ['admin', 'coach', 'league_manager'].includes(useAuthStore.getState().profile?.role ?? '');
    const useAdminCache = useAuthStore.getState().profile?.role === 'admin';
    set(state => ({ players: buildMergedPlayers(priv, useAdminCache), loading: state.loading }));
  },

  updatePlayer: async (player) => {
    const { dateOfBirth: _dob, parentContact: _pc, parentContact2: _pc2, emergencyContact: _ec, ...mainFields } = player;
    await setDoc(doc(db, 'players', player.id), mainFields);
  },

  updateSensitiveData: async (playerId, teamId, data) => {
    const existing = _sensitiveMap[playerId] ?? { playerId, teamId };
    const updated: SensitivePlayerData = { ...existing, ...data, playerId, teamId };
    await setDoc(doc(db, 'players', playerId, 'sensitiveData', 'private'), updated);
    _sensitiveMap[playerId] = updated;
    const priv = ['admin', 'coach', 'league_manager'].includes(useAuthStore.getState().profile?.role ?? '');
    const useAdminCache = useAuthStore.getState().profile?.role === 'admin';
    set(state => ({ players: buildMergedPlayers(priv, useAdminCache), loading: state.loading }));
  },

  deletePlayer: async (id) => {
    await deleteDoc(doc(db, 'players', id));
    delete _sensitiveMap[id];
  },

  deletePlayersForTeam: async (teamId) => {
    const batch = writeBatch(db);
    const scoped = _playersByTeam[teamId] ?? [];
    scoped.forEach(p => {
      batch.delete(doc(db, 'players', p.id));
      delete _sensitiveMap[p.id];
    });
    // Admin may only have _adminPlayers populated; cover that branch too.
    if (scoped.length === 0 && _adminPlayers) {
      _adminPlayers.filter(p => p.teamId === teamId).forEach(p => {
        batch.delete(doc(db, 'players', p.id));
        delete _sensitiveMap[p.id];
      });
    }
    await batch.commit();
  },
}));
