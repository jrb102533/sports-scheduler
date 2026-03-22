import { create } from 'zustand';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import type { AppSettings } from '@/types';

const DEFAULT_SETTINGS: AppSettings = {
  kidsSportsMode: false,
  hideStandingsInKidsMode: false,
};

interface SettingsStore {
  settings: AppSettings;
  subscribe: (uid: string) => () => void;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,

  subscribe: (uid: string) => {
    const unsub = onSnapshot(doc(db, 'users', uid, 'config', 'settings'), (snap) => {
      if (snap.exists()) {
        set({ settings: snap.data() as AppSettings });
      }
    });
    return unsub;
  },

  updateSettings: async (patch) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await setDoc(doc(db, 'users', uid, 'config', 'settings'), settings);
  },
}));
