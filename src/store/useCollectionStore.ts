import { create } from 'zustand';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { AvailabilityCollection, CoachAvailabilityResponse, WizardDraft } from '@/types';

export type CoachResponseStatus = 'responded' | 'pending' | 'no_account';

export interface CoachResponseSummary {
  coachUid: string;
  coachName: string;
  teamId: string;
  teamName: string;
  status: CoachResponseStatus;
  submittedAt?: string;
}

interface CollectionStore {
  /** Active collection for the currently viewed league, if any */
  activeCollection: AvailabilityCollection | null;
  responses: CoachAvailabilityResponse[];
  responseSummaries: CoachResponseSummary[];
  wizardDraft: WizardDraft | null;

  loadCollection: (leagueId: string) => () => void;
  loadWizardDraft: (leagueId: string) => () => void;

  saveWizardDraft: (leagueId: string, draft: Omit<WizardDraft, 'updatedAt'>) => Promise<void>;
  clearWizardDraft: (leagueId: string) => Promise<void>;

  createCollection: (leagueId: string, dueDate: string, createdBy: string) => Promise<string>;
  closeCollection: (leagueId: string, collectionId: string) => Promise<void>;
  reopenCollection: (leagueId: string, collectionId: string, newDueDate: string) => Promise<void>;

  submitResponse: (
    leagueId: string,
    collectionId: string,
    response: Omit<CoachAvailabilityResponse, 'submittedAt'>
  ) => Promise<void>;
}

export const useCollectionStore = create<CollectionStore>((set) => ({
  activeCollection: null,
  responses: [],
  responseSummaries: [],
  wizardDraft: null,

  loadCollection: (leagueId) => {
    // Subscribe to the most recent open/closed collection for this league
    const unsub = onSnapshot(
      collection(db, 'leagues', leagueId, 'availabilityCollections'),
      async (snap) => {
        // Find the most recent non-expired collection
        const docs = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as AvailabilityCollection))
          .filter(c => c.status !== 'expired')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const active = docs[0] ?? null;
        set({ activeCollection: active });

        if (active) {
          // Load responses subcollection
          const responsesSnap = await getDocs(
            collection(db, 'leagues', leagueId, 'availabilityCollections', active.id, 'responses')
          );
          const responses = responsesSnap.docs.map(d => d.data() as CoachAvailabilityResponse);
          set({ responses });
        } else {
          set({ responses: [] });
        }
      },
      () => set({ activeCollection: null, responses: [] })
    );
    return unsub;
  },

  loadWizardDraft: (leagueId) => {
    const unsub = onSnapshot(
      doc(db, 'leagues', leagueId, 'wizardDraft', 'draft'),
      (snap) => {
        if (snap.exists()) {
          set({ wizardDraft: snap.data() as WizardDraft });
        } else {
          set({ wizardDraft: null });
        }
      },
      () => set({ wizardDraft: null })
    );
    return unsub;
  },

  saveWizardDraft: async (leagueId, draft) => {
    const now = new Date().toISOString();
    const full: WizardDraft = { ...draft, updatedAt: now };
    await setDoc(doc(db, 'leagues', leagueId, 'wizardDraft', 'draft'), full);
    set({ wizardDraft: full });
  },

  clearWizardDraft: async (leagueId) => {
    await setDoc(doc(db, 'leagues', leagueId, 'wizardDraft', 'draft'), {});
    set({ wizardDraft: null });
  },

  createCollection: async (leagueId, dueDate, createdBy) => {
    const id = `col_${Date.now()}`;
    const now = new Date().toISOString();
    const data: AvailabilityCollection = {
      id,
      leagueId,
      dueDate,
      status: 'open',
      createdAt: now,
      createdBy,
    };
    await setDoc(
      doc(db, 'leagues', leagueId, 'availabilityCollections', id),
      data
    );
    set({ activeCollection: data, responses: [] });
    return id;
  },

  closeCollection: async (leagueId, collectionId) => {
    const now = new Date().toISOString();
    await updateDoc(
      doc(db, 'leagues', leagueId, 'availabilityCollections', collectionId),
      { status: 'closed', closedAt: now }
    );
    set(state => ({
      activeCollection: state.activeCollection
        ? { ...state.activeCollection, status: 'closed', closedAt: now }
        : null,
    }));
  },

  reopenCollection: async (leagueId, collectionId, newDueDate) => {
    await updateDoc(
      doc(db, 'leagues', leagueId, 'availabilityCollections', collectionId),
      { status: 'open', dueDate: newDueDate, closedAt: null }
    );
    set(state => ({
      activeCollection: state.activeCollection
        ? { ...state.activeCollection, status: 'open', dueDate: newDueDate, closedAt: undefined }
        : null,
    }));
  },

  submitResponse: async (leagueId, collectionId, response) => {
    const full: CoachAvailabilityResponse = {
      ...response,
      submittedAt: new Date().toISOString(),
    };
    await setDoc(
      doc(db, 'leagues', leagueId, 'availabilityCollections', collectionId, 'responses', response.coachUid),
      full
    );
    set(state => {
      const existing = state.responses.filter(r => r.coachUid !== response.coachUid);
      return { responses: [...existing, full] };
    });
  },
}));
