import { create } from 'zustand';
import type { Player } from '@/types';
import { getItem, setItem } from '@/lib/localStorage';
import { STORAGE_KEYS } from '@/constants';

interface PlayerStore {
  players: Player[];
  addPlayer: (player: Player) => void;
  updatePlayer: (player: Player) => void;
  deletePlayer: (id: string) => void;
  deletePlayersForTeam: (teamId: string) => void;
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  players: getItem<Player[]>(STORAGE_KEYS.PLAYERS) ?? [],

  addPlayer: (player) => {
    const players = [...get().players, player];
    set({ players });
    setItem(STORAGE_KEYS.PLAYERS, players);
  },

  updatePlayer: (player) => {
    const players = get().players.map(p => p.id === player.id ? player : p);
    set({ players });
    setItem(STORAGE_KEYS.PLAYERS, players);
  },

  deletePlayer: (id) => {
    const players = get().players.filter(p => p.id !== id);
    set({ players });
    setItem(STORAGE_KEYS.PLAYERS, players);
  },

  deletePlayersForTeam: (teamId) => {
    const players = get().players.filter(p => p.teamId !== teamId);
    set({ players });
    setItem(STORAGE_KEYS.PLAYERS, players);
  },
}));
