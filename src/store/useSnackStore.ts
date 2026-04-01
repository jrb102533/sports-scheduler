import { create } from 'zustand';
import {
  doc, onSnapshot, setDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface SnackSlot {
  claimedBy: string | null;
  claimedByName: string | null;
  claimedAt: string | null;
}

interface SnackStore {
  slots: Record<string, SnackSlot>;
  claimSlot: (eventId: string, uid: string, name: string) => Promise<void>;
  releaseSlot: (eventId: string) => Promise<void>;
  subscribeSlot: (eventId: string) => () => void;
}

const SLOT_DOC_ID = 'slot';

export const useSnackStore = create<SnackStore>((set) => ({
  slots: {},

  claimSlot: async (eventId, uid, name) => {
    const slot: SnackSlot = {
      claimedBy: uid,
      claimedByName: name,
      claimedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'events', eventId, 'snackSlot', SLOT_DOC_ID), slot);
  },

  releaseSlot: async (eventId) => {
    const slot: SnackSlot = {
      claimedBy: null,
      claimedByName: null,
      claimedAt: null,
    };
    await setDoc(doc(db, 'events', eventId, 'snackSlot', SLOT_DOC_ID), slot);
  },

  subscribeSlot: (eventId) => {
    const unsub = onSnapshot(
      doc(db, 'events', eventId, 'snackSlot', SLOT_DOC_ID),
      (snap) => {
        const slot: SnackSlot = snap.exists()
          ? (snap.data() as SnackSlot)
          : { claimedBy: null, claimedByName: null, claimedAt: null };
        set(state => ({ slots: { ...state.slots, [eventId]: slot } }));
      },
      () => {
        // On error, leave existing state in place
      }
    );
    return unsub;
  },
}));
