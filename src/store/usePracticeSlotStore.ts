import { create } from 'zustand';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { db } from '@/lib/firebase';
import type { PracticeSlotWindow, PracticeSlotSignup } from '@/types';

// ─── Callable input types (mirror functions/src/practiceSlots.ts) ─────────────

interface SignUpInput {
  leagueId: string;
  seasonId: string;
  windowId: string;
  occurrenceDate: string;
  teamId: string;
  teamName: string;
}

interface CancelSignupInput {
  leagueId: string;
  seasonId: string;
  signupId: string;
}

interface AddBlackoutInput {
  leagueId: string;
  seasonId: string;
  windowId: string;
  date: string;
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface PracticeSlotStore {
  windows: PracticeSlotWindow[];
  signups: PracticeSlotSignup[];
  loading: boolean;
  error: string | null;

  /** Subscribe to all slot windows for a season. Returns unsubscribe fn. */
  subscribeWindows: (leagueId: string, seasonId: string) => () => void;
  /** Subscribe to all signups for a season (LM view). Returns unsubscribe fn. */
  subscribeSignups: (leagueId: string, seasonId: string) => () => void;
  /** Subscribe to a single team's signups only (coach view). Returns unsubscribe fn. */
  subscribeTeamSignups: (leagueId: string, seasonId: string, teamId: string) => () => void;

  /** Sign a team up for a slot occurrence (FCFS, handled server-side). */
  signUp: (input: SignUpInput) => Promise<{ signupId: string; status: 'confirmed' | 'waitlisted' }>;
  /** Cancel a signup. Auto-promotes waitlisted team server-side. */
  cancelSignup: (input: CancelSignupInput) => Promise<void>;
  /** Add a blackout date to a window. Cancels affected bookings server-side. */
  addBlackout: (input: AddBlackoutInput) => Promise<{ affectedTeams: string[] }>;
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const usePracticeSlotStore = create<PracticeSlotStore>((set) => ({
  windows: [],
  signups: [],
  loading: false,
  error: null,

  subscribeWindows: (leagueId, seasonId) => {
    set({ loading: true });
    const col = collection(db, 'leagues', leagueId, 'seasons', seasonId, 'practiceSlotWindows');
    const unsub = onSnapshot(
      col,
      (snap) => {
        const windows = snap.docs.map(d => ({ ...d.data(), id: d.id }) as PracticeSlotWindow);
        set({ windows, loading: false });
      },
      () => set({ loading: false }),
    );
    return unsub;
  },

  subscribeSignups: (leagueId, seasonId) => {
    const col = collection(db, 'leagues', leagueId, 'seasons', seasonId, 'practiceSlotSignups');
    const unsub = onSnapshot(
      col,
      (snap) => {
        const signups = snap.docs.map(d => ({ ...d.data(), id: d.id }) as PracticeSlotSignup);
        set({ signups });
      },
      () => {},
    );
    return unsub;
  },

  subscribeTeamSignups: (leagueId, seasonId, teamId) => {
    const col = collection(db, 'leagues', leagueId, 'seasons', seasonId, 'practiceSlotSignups');
    const q = query(col, where('teamId', '==', teamId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const signups = snap.docs.map(d => ({ ...d.data(), id: d.id }) as PracticeSlotSignup);
        set({ signups });
      },
      () => {},
    );
    return unsub;
  },

  signUp: async (input) => {
    const fn = httpsCallable<SignUpInput, { signupId: string; status: 'confirmed' | 'waitlisted' }>(
      getFunctions(), 'practiceSlotSignUp',
    );
    const { data } = await fn(input);
    return data;
  },

  cancelSignup: async (input) => {
    const fn = httpsCallable<CancelSignupInput, { success: boolean }>(
      getFunctions(), 'practiceSlotCancel',
    );
    await fn(input);
  },

  addBlackout: async (input) => {
    const fn = httpsCallable<AddBlackoutInput, { affectedTeams: string[] }>(
      getFunctions(), 'practiceSlotAddBlackout',
    );
    const { data } = await fn(input);
    return data;
  },
}));
