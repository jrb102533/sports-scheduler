import { create } from 'zustand';
import type { AppNotification } from '@/types';
import { getItem, setItem } from '@/lib/localStorage';
import { STORAGE_KEYS } from '@/constants';

interface NotificationStore {
  notifications: AppNotification[];
  panelOpen: boolean;
  addNotification: (n: AppNotification) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  setPanelOpen: (open: boolean) => void;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: getItem<AppNotification[]>(STORAGE_KEYS.NOTIFICATIONS) ?? [],
  panelOpen: false,

  addNotification: (n) => {
    const notifications = [n, ...get().notifications];
    set({ notifications });
    setItem(STORAGE_KEYS.NOTIFICATIONS, notifications);
  },

  markRead: (id) => {
    const notifications = get().notifications.map(n =>
      n.id === id ? { ...n, isRead: true } : n
    );
    set({ notifications });
    setItem(STORAGE_KEYS.NOTIFICATIONS, notifications);
  },

  markAllRead: () => {
    const notifications = get().notifications.map(n => ({ ...n, isRead: true }));
    set({ notifications });
    setItem(STORAGE_KEYS.NOTIFICATIONS, notifications);
  },

  clearAll: () => {
    set({ notifications: [] });
    setItem(STORAGE_KEYS.NOTIFICATIONS, []);
  },

  setPanelOpen: (open) => set({ panelOpen: open }),
}));
