import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, updateDoc, query, where, orderBy,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Division } from '@/types';

interface DivisionStore {
  divisions: Division[];
  loading: boolean;
  error: string | null;
  fetchDivisions: (leagueId: string, seasonId: string) => () => void;
  createDivision: (leagueId: string, seasonId: string, data: Pick<Division, 'name' | 'teamIds'>) => Promise<Division>;
  updateDivision: (leagueId: string, divisionId: string, data: Partial<Division>) => Promise<void>;
  addTeamToDivision: (leagueId: string, divisionId: string, teamId: string) => Promise<void>;
  removeTeamFromDivision: (leagueId: string, divisionId: string, teamId: string) => Promise<void>;
}

export const useDivisionStore = create<DivisionStore>((set, get) => ({
  divisions: [],
  loading: false,
  error: null,

  fetchDivisions: (leagueId: string, seasonId: string) => {
    set({ loading: true, error: null });
    const q = query(
      collection(db, 'leagues', leagueId, 'divisions'),
      where('seasonId', '==', seasonId),
      orderBy('createdAt'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const divisions = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Division);
        set({ divisions, loading: false });
      },
      (err) => {
        set({ loading: false, error: err.message });
      },
    );
    return unsub;
  },

  createDivision: async (leagueId, seasonId, data) => {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const division: Division = {
      id,
      name: data.name,
      teamIds: data.teamIds,
      scheduleStatus: 'none',
      seasonId,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(doc(db, 'leagues', leagueId, 'divisions', id), division);
    return division;
  },

  updateDivision: async (leagueId, divisionId, data) => {
    const now = new Date().toISOString();
    await updateDoc(doc(db, 'leagues', leagueId, 'divisions', divisionId), {
      ...data,
      updatedAt: now,
    });
  },

  addTeamToDivision: async (leagueId, divisionId, teamId) => {
    const division = get().divisions.find(d => d.id === divisionId);
    if (!division || division.teamIds.includes(teamId)) return;
    const updatedTeamIds = [...division.teamIds, teamId];
    await updateDoc(doc(db, 'leagues', leagueId, 'divisions', divisionId), {
      teamIds: updatedTeamIds,
      updatedAt: new Date().toISOString(),
    });
  },

  removeTeamFromDivision: async (leagueId, divisionId, teamId) => {
    const division = get().divisions.find(d => d.id === divisionId);
    if (!division) return;
    const updatedTeamIds = division.teamIds.filter(id => id !== teamId);
    await updateDoc(doc(db, 'leagues', leagueId, 'divisions', divisionId), {
      teamIds: updatedTeamIds,
      updatedAt: new Date().toISOString(),
    });
  },
}));
