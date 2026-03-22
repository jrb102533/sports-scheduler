import { create } from 'zustand';
import type { AppSettings } from '@/types';
import { getItem, setItem } from '@/lib/localStorage';
import { STORAGE_KEYS } from '@/constants';

const DEFAULT_SETTINGS: AppSettings = {
  kidsSportsMode: false,
  hideStandingsInKidsMode: false,
};

interface SettingsStore {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: getItem<AppSettings>(STORAGE_KEYS.SETTINGS) ?? DEFAULT_SETTINGS,
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    setItem(STORAGE_KEYS.SETTINGS, settings);
  },
}));
