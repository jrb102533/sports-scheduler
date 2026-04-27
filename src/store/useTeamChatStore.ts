import { create } from 'zustand';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
  limit,
  startAfter,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { TeamMessage } from '@/types';

const PAGE_SIZE = 25;

interface TeamChatState {
  messages: TeamMessage[];
  loading: boolean;
  loadingOlder: boolean;
  teamId: string | null;
  /** Cursor for the OLDEST currently-loaded message; null until first page. */
  oldestCursor: QueryDocumentSnapshot<DocumentData> | null;
  /** True once we've fetched a page smaller than PAGE_SIZE. */
  reachedStart: boolean;
  subscribe: (teamId: string) => () => void;
  loadOlder: () => Promise<void>;
  sendMessage: (teamId: string, senderId: string, senderName: string, text: string) => Promise<void>;
}

function snapToMessage(d: QueryDocumentSnapshot<DocumentData>): TeamMessage {
  const data = d.data();
  const createdAt =
    data.createdAt instanceof Timestamp
      ? data.createdAt.toDate().toISOString()
      : (data.createdAt as string) ?? new Date().toISOString();
  return { id: d.id, ...(data as Omit<TeamMessage, 'id' | 'createdAt'>), createdAt };
}

export const useTeamChatStore = create<TeamChatState>((set, get) => ({
  messages: [],
  loading: false,
  loadingOlder: false,
  teamId: null,
  oldestCursor: null,
  reachedStart: false,

  subscribe(teamId: string) {
    if (get().teamId === teamId && get().messages.length > 0) {
      return () => {};
    }
    set({
      loading: true,
      teamId,
      messages: [],
      oldestCursor: null,
      reachedStart: false,
    });

    // Subscribe to the latest PAGE_SIZE messages using desc order, then
    // reverse client-side for ascending display. Older history is fetched
    // explicitly via loadOlder so the live snapshot window stays bounded.
    const q = query(
      collection(db, 'teams', teamId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE),
    );

    const unsub = onSnapshot(
      q,
      snap => {
        const desc = snap.docs.map(snapToMessage);
        const ascending = [...desc].reverse();
        const oldestSnap = snap.docs[snap.docs.length - 1] ?? null;
        set({
          messages: ascending,
          loading: false,
          oldestCursor: oldestSnap,
          reachedStart: snap.docs.length < PAGE_SIZE,
        });
      },
      err => {
        console.error('[useTeamChatStore] snapshot error:', err);
        set({ loading: false });
      },
    );

    return unsub;
  },

  async loadOlder() {
    const { teamId, oldestCursor, loadingOlder, reachedStart, messages } = get();
    if (!teamId || !oldestCursor || loadingOlder || reachedStart) return;

    set({ loadingOlder: true });
    try {
      const q = query(
        collection(db, 'teams', teamId, 'messages'),
        orderBy('createdAt', 'desc'),
        startAfter(oldestCursor),
        limit(PAGE_SIZE),
      );
      const snap = await getDocs(q);
      const olderDesc = snap.docs.map(snapToMessage);
      const olderAsc = [...olderDesc].reverse();
      const newOldest = snap.docs[snap.docs.length - 1] ?? oldestCursor;
      set({
        messages: [...olderAsc, ...messages],
        oldestCursor: newOldest,
        reachedStart: snap.docs.length < PAGE_SIZE,
        loadingOlder: false,
      });
    } catch (err) {
      console.error('[useTeamChatStore] loadOlder error:', err);
      set({ loadingOlder: false });
    }
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
