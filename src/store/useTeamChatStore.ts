import { create } from 'zustand';
import {
  collection,
  query,
  orderBy,
  where,
  onSnapshot,
  getDocs,
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
  /** Internal — not part of the public interface */
  _unsub?: () => void;
  subscribe: (teamId: string) => () => void;
  loadOlder: (teamId: string) => Promise<void>;
  sendMessage: (teamId: string, senderId: string, senderName: string, text: string) => Promise<void>;
}

function toIso(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

export const useTeamChatStore = create<TeamChatState>((set) => ({
  messages: [],
  loading: false,
  teamId: null,
  _unsub: undefined,

  subscribe(teamId: string) {
    set({ loading: true, teamId, messages: [] });

    // Step 1: fetch last 50 messages once
    getDocs(query(
      collection(db, 'teams', teamId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(50),
    )).then(snap => {
      const history = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as TeamMessage & { createdAt: unknown }))
        .map(m => ({ ...m, createdAt: toIso(m.createdAt) }))
        .reverse() as TeamMessage[];

      const cursor: Timestamp = snap.docs[0]?.data().createdAt instanceof Timestamp
        ? snap.docs[0].data().createdAt as Timestamp
        : Timestamp.now();

      set({ messages: history, loading: false });

      // Step 2: subscribe only to new messages after the cursor
      const unsub = onSnapshot(
        query(
          collection(db, 'teams', teamId, 'messages'),
          where('createdAt', '>', cursor),
          orderBy('createdAt', 'asc'),
        ),
        snap => {
          snap.docChanges().forEach(change => {
            if (change.type === 'added') {
              const raw = change.doc.data();
              const msg: TeamMessage = {
                id: change.doc.id,
                teamId: raw.teamId as string,
                senderId: raw.senderId as string,
                senderName: raw.senderName as string,
                text: raw.text as string,
                createdAt: toIso(raw.createdAt),
              };
              set(state => ({ messages: [...state.messages, msg] }));
            }
          });
        },
        err => {
          console.error('[useTeamChatStore] live snapshot error:', err);
        },
      );

      set({ _unsub: unsub });
    }).catch(err => {
      console.error('[useTeamChatStore] initial fetch error:', err);
      set({ loading: false });
    });

    return () => {
      const state = useTeamChatStore.getState();
      state._unsub?.();
      set({ _unsub: undefined });
    };
  },

  async loadOlder(teamId: string) {
    const oldest = useTeamChatStore.getState().messages[0];
    if (!oldest) return;

    // Convert ISO string back to Timestamp for the Firestore query
    const oldestTimestamp = Timestamp.fromDate(new Date(oldest.createdAt));

    const snap = await getDocs(query(
      collection(db, 'teams', teamId, 'messages'),
      orderBy('createdAt', 'desc'),
      where('createdAt', '<', oldestTimestamp),
      limit(50),
    ));
    const older = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as TeamMessage & { createdAt: unknown }))
      .map(m => ({ ...m, createdAt: toIso(m.createdAt) }))
      .reverse() as TeamMessage[];

    set(state => ({ messages: [...older, ...state.messages] }));
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
