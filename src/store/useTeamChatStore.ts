import { create } from 'zustand';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  Timestamp,
  limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { TeamMessage } from '@/types';

interface TeamChatState {
  messages: TeamMessage[];
  loading: boolean;
  teamId: string | null;
  subscribe: (teamId: string) => () => void;
  sendMessage: (teamId: string, senderId: string, senderName: string, text: string) => Promise<void>;
}

export const useTeamChatStore = create<TeamChatState>((set, get) => ({
  messages: [],
  loading: false,
  teamId: null,

  subscribe(teamId: string) {
    // Skip re-subscribe if same team
    if (get().teamId === teamId && get().messages.length > 0) {
      return () => {};
    }
    set({ loading: true, teamId, messages: [] });

    const q = query(
      collection(db, 'teams', teamId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(200),
    );

    const unsub = onSnapshot(
      q,
      snap => {
        const messages: TeamMessage[] = snap.docs.map(d => {
          const data = d.data();
          const createdAt =
            data.createdAt instanceof Timestamp
              ? data.createdAt.toDate().toISOString()
              : (data.createdAt as string) ?? new Date().toISOString();
          return { id: d.id, ...(data as Omit<TeamMessage, 'id' | 'createdAt'>), createdAt };
        });
        set({ messages, loading: false });
      },
      err => {
        console.error('[useTeamChatStore] snapshot error:', err);
        set({ loading: false });
      },
    );

    return unsub;
  },

  async sendMessage(teamId, senderId, senderName, text) {
    await addDoc(collection(db, 'teams', teamId, 'messages'), {
      teamId,
      senderId,
      senderName,
      text: text.trim(),
      createdAt: serverTimestamp(),
    });
  },
}));
