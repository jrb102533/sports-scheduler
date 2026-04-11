import { create } from 'zustand';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  setDoc,
  doc,
  serverTimestamp,
  Timestamp,
  limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { DmThread, DmMessage } from '@/types';

/** Canonical threadId: sorted UIDs joined by underscore */
export function dmThreadId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('_');
}

interface DmState {
  threads: DmThread[];
  messages: DmMessage[];
  activeThreadId: string | null;
  loadingThreads: boolean;
  loadingMessages: boolean;
  subscribeThreads: (uid: string) => () => void;
  subscribeMessages: (threadId: string) => () => void;
  sendDm: (
    myUid: string,
    myName: string,
    otherUid: string,
    otherName: string,
    text: string,
  ) => Promise<void>;
}

function toIso(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

export const useDmStore = create<DmState>((set) => ({
  threads: [],
  messages: [],
  activeThreadId: null,
  loadingThreads: false,
  loadingMessages: false,

  subscribeThreads(uid: string) {
    set({ loadingThreads: true, threads: [] });

    const q = query(
      collection(db, 'dmThreads'),
      where('participants', 'array-contains', uid),
      orderBy('updatedAt', 'desc'),
    );

    const unsub = onSnapshot(
      q,
      snap => {
        const threads: DmThread[] = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            participants: data.participants as [string, string],
            participantNames: data.participantNames as Record<string, string>,
            lastMessage: data.lastMessage as string ?? '',
            lastMessageAt: toIso(data.lastMessageAt),
            updatedAt: toIso(data.updatedAt),
          };
        });
        set({ threads, loadingThreads: false });
      },
      err => {
        console.error('[useDmStore] threads snapshot error:', err);
        set({ loadingThreads: false });
      },
    );

    return unsub;
  },

  subscribeMessages(threadId: string) {
    set({ loadingMessages: true, messages: [], activeThreadId: threadId });

    const q = query(
      collection(db, 'dmThreads', threadId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(200),
    );

    const unsub = onSnapshot(
      q,
      snap => {
        const messages: DmMessage[] = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            threadId,
            senderId: data.senderId as string,
            senderName: data.senderName as string,
            text: data.text as string,
            createdAt: toIso(data.createdAt),
          };
        });
        set({ messages, loadingMessages: false });
      },
      err => {
        console.error('[useDmStore] messages snapshot error:', err);
        set({ loadingMessages: false });
      },
    );

    return unsub;
  },

  async sendDm(myUid, myName, otherUid, otherName, text) {
    const threadId = dmThreadId(myUid, otherUid);
    const threadRef = doc(db, 'dmThreads', threadId);
    const now = serverTimestamp();

    // Upsert thread metadata
    await setDoc(
      threadRef,
      {
        participants: [myUid, otherUid].sort(),
        participantNames: { [myUid]: myName, [otherUid]: otherName },
        lastMessage: text.trim(),
        lastMessageAt: now,
        updatedAt: now,
      },
      { merge: true },
    );

    // Write the message
    await addDoc(collection(db, 'dmThreads', threadId, 'messages'), {
      threadId,
      senderId: myUid,
      senderName: myName,
      text: text.trim(),
      createdAt: now,
    });
  },
}));
