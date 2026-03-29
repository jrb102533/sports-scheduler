import { create } from 'zustand';
import {
  collection, getDocs, doc, setDoc, updateDoc, query, orderBy,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { todayISO } from '@/lib/dateUtils';
import type { Absence } from '@/types';

interface AbsenceStore {
  /** Map of teamId → absences for that team (all records, active + historical) */
  absencesByTeam: Record<string, Absence[]>;
  loading: boolean;

  fetchAbsences: (teamId: string) => Promise<void>;
  addAbsence: (absence: Absence) => Promise<void>;
  updateAbsence: (teamId: string, absenceId: string, patch: Partial<Absence>) => Promise<void>;
  resolveAbsence: (teamId: string, absenceId: string) => Promise<void>;

  /** Returns absences that are currently active for a team (client-side filtered). */
  getActiveAbsences: (teamId: string) => Absence[];
  /** Returns active absence for a specific player, or undefined. */
  getActiveAbsenceForPlayer: (teamId: string, playerId: string) => Absence | undefined;
}

/** An absence is active when it has not been manually resolved AND endDate >= today. */
function isActive(absence: Absence, today: string): boolean {
  return !absence.resolvedAt && absence.endDate >= today;
}

export const useAbsenceStore = create<AbsenceStore>((set, get) => ({
  absencesByTeam: {},
  loading: false,

  fetchAbsences: async (teamId) => {
    set({ loading: true });
    try {
      const q = query(
        collection(db, 'teams', teamId, 'absences'),
        orderBy('createdAt', 'desc'),
      );
      const snap = await getDocs(q);
      const absences = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Absence);
      set(state => ({
        absencesByTeam: { ...state.absencesByTeam, [teamId]: absences },
      }));
    } finally {
      set({ loading: false });
    }
  },

  addAbsence: async (absence) => {
    await setDoc(doc(db, 'teams', absence.teamId, 'absences', absence.id), absence);
    set(state => {
      const existing = state.absencesByTeam[absence.teamId] ?? [];
      return {
        absencesByTeam: {
          ...state.absencesByTeam,
          [absence.teamId]: [absence, ...existing],
        },
      };
    });
  },

  updateAbsence: async (teamId, absenceId, patch) => {
    await updateDoc(doc(db, 'teams', teamId, 'absences', absenceId), patch as Record<string, unknown>);
    set(state => {
      const existing = state.absencesByTeam[teamId] ?? [];
      return {
        absencesByTeam: {
          ...state.absencesByTeam,
          [teamId]: existing.map(a => a.id === absenceId ? { ...a, ...patch } : a),
        },
      };
    });
  },

  resolveAbsence: async (teamId, absenceId) => {
    const resolvedAt = new Date().toISOString();
    await updateDoc(doc(db, 'teams', teamId, 'absences', absenceId), { resolvedAt });
    set(state => {
      const existing = state.absencesByTeam[teamId] ?? [];
      return {
        absencesByTeam: {
          ...state.absencesByTeam,
          [teamId]: existing.map(a => a.id === absenceId ? { ...a, resolvedAt } : a),
        },
      };
    });
  },

  getActiveAbsences: (teamId) => {
    const today = todayISO();
    return (get().absencesByTeam[teamId] ?? []).filter(a => isActive(a, today));
  },

  getActiveAbsenceForPlayer: (teamId, playerId) => {
    const today = todayISO();
    return (get().absencesByTeam[teamId] ?? []).find(
      a => a.playerId === playerId && isActive(a, today),
    );
  },
}));
