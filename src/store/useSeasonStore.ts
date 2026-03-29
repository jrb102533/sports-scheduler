import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, query, orderBy,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Season } from '@/types';

interface SeasonStore {
  seasons: Season[];
  activeSeason: Season | null;
  loading: boolean;
  error: string | null;
  fetchSeasons: (leagueId: string) => () => void;
  createSeason: (leagueId: string, data: Omit<Season, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Season>;
  setActiveSeason: (season: Season | null) => void;
  archiveSeason: (leagueId: string, seasonId: string) => Promise<void>;
}

export const useSeasonStore = create<SeasonStore>((set, get) => ({
  seasons: [],
  activeSeason: null,
  loading: false,
  error: null,

  fetchSeasons: (leagueId: string) => {
    set({ loading: true, error: null });
    const q = query(
      collection(db, 'leagues', leagueId, 'seasons'),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const seasons = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Season);
        set({ seasons, loading: false });
      },
      (err) => {
        set({ loading: false, error: err.message });
      },
    );
    return unsub;
  },

  createSeason: async (leagueId, data) => {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const season: Season = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(doc(db, 'leagues', leagueId, 'seasons', id), season);
    return season;
  },

  setActiveSeason: (season) => {
    set({ activeSeason: season });
  },

  archiveSeason: async (leagueId, seasonId) => {
    const season = get().seasons.find(s => s.id === seasonId);
    if (!season) return;
    const updated: Season = {
      ...season,
      status: 'archived',
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'leagues', leagueId, 'seasons', seasonId), updated);
  },
}));
