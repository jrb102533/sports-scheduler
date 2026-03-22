import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, query, orderBy, writeBatch,
} from 'firebase/firestore';
import { auth } from '@/lib/firebase';
import { db } from '@/lib/firebase';
import type { AppNotification } from '@/types';

interface NotificationStore {
  notifications: AppNotification[];
  panelOpen: boolean;
  subscribe: (uid: string) => () => void;
  addNotification: (n: AppNotification) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearAll: () => Promise<void>;
  setPanelOpen: (open: boolean) => void;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  panelOpen: false,

  subscribe: (uid: string) => {
    const q = query(collection(db, 'users', uid, 'notifications'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const notifications = snap.docs.map(d => ({ ...d.data(), id: d.id }) as AppNotification);
      set({ notifications });
    });
    return unsub;
  },

  addNotification: async (n) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await setDoc(doc(db, 'users', uid, 'notifications', n.id), n);
  },

  markRead: async (id) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const n = get().notifications.find(x => x.id === id);
    if (!n) return;
    await setDoc(doc(db, 'users', uid, 'notifications', id), { ...n, isRead: true });
  },

  markAllRead: async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const batch = writeBatch(db);
    get().notifications.filter(n => !n.isRead).forEach(n => {
      batch.set(doc(db, 'users', uid, 'notifications', n.id), { ...n, isRead: true });
    });
    await batch.commit();
  },

  clearAll: async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const batch = writeBatch(db);
    get().notifications.forEach(n => {
      batch.delete(doc(db, 'users', uid, 'notifications', n.id));
    });
    await batch.commit();
  },

  setPanelOpen: (open) => set({ panelOpen: open }),
}));
