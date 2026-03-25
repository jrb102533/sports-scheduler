import { create } from 'zustand';
import { collection, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface UnavailableWindow {
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  reason?: string;
}

export interface AvailabilityDoc {
  playerId: string;
  windows: UnavailableWindow[];
  updatedAt: string;
}

interface AvailabilityStore {
  /** Keyed by playerId */
  availability: Record<string, AvailabilityDoc>;
  /** Currently subscribed teamId */
  loadedTeamId: string | null;

  /**
   * Subscribe to teams/{teamId}/availability subcollection.
   * Returns the unsubscribe function.
   */
  loadAvailability: (teamId: string) => () => void;

  /** Write (or overwrite) the availability doc for a player. */
  setUnavailable: (teamId: string, playerId: string, windows: UnavailableWindow[]) => Promise<void>;

  /** Returns false if date falls within any unavailability window for the player. */
  isPlayerAvailable: (playerId: string, date: string) => boolean;
}

export const useAvailabilityStore = create<AvailabilityStore>((set, get) => ({
  availability: {},
  loadedTeamId: null,

  loadAvailability: (teamId: string) => {
    const unsub = onSnapshot(
      collection(db, 'teams', teamId, 'availability'),
      (snap) => {
        const next: Record<string, AvailabilityDoc> = {};
        snap.docs.forEach(d => {
          const data = d.data() as AvailabilityDoc;
          next[data.playerId] = data;
        });
        set({ availability: next, loadedTeamId: teamId });
      },
      () => {
        // On error just ensure state is not stale for a different team
        set({ loadedTeamId: teamId });
      }
    );
    return unsub;
  },

  setUnavailable: async (teamId, playerId, windows) => {
    const now = new Date().toISOString();
    const docData: AvailabilityDoc = { playerId, windows, updatedAt: now };
    await setDoc(doc(db, 'teams', teamId, 'availability', playerId), docData);
    // Optimistically update local state
    set(state => ({
      availability: { ...state.availability, [playerId]: docData },
    }));
  },

  isPlayerAvailable: (playerId, date) => {
    const doc = get().availability[playerId];
    if (!doc) return true;
    return !doc.windows.some(w => date >= w.startDate && date <= w.endDate);
  },
}));
