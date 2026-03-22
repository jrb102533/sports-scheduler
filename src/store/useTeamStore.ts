import { create } from 'zustand';
import type { Team } from '@/types';
import { getItem, setItem } from '@/lib/localStorage';
import { STORAGE_KEYS } from '@/constants';

interface TeamStore {
  teams: Team[];
  addTeam: (team: Team) => void;
  updateTeam: (team: Team) => void;
  deleteTeam: (id: string) => void;
}

export const useTeamStore = create<TeamStore>((set, get) => ({
  teams: getItem<Team[]>(STORAGE_KEYS.TEAMS) ?? [],

  addTeam: (team) => {
    const teams = [...get().teams, team];
    set({ teams });
    setItem(STORAGE_KEYS.TEAMS, teams);
  },

  updateTeam: (team) => {
    const teams = get().teams.map(t => t.id === team.id ? team : t);
    set({ teams });
    setItem(STORAGE_KEYS.TEAMS, teams);
  },

  deleteTeam: (id) => {
    const teams = get().teams.filter(t => t.id !== id);
    set({ teams });
    setItem(STORAGE_KEYS.TEAMS, teams);
  },
}));
