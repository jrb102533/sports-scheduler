import { create } from 'zustand';
import {
  collection, onSnapshot, doc, setDoc, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { LeagueVenue, Venue } from '@/types';

interface LeagueVenueStore {
  venues: LeagueVenue[];
  leagueId: string | null;
  loading: boolean;
  subscribe: (leagueId: string) => () => void;
  importVenue: (leagueId: string, source: Venue, lmUid: string) => Promise<LeagueVenue>;
  updateLeagueVenue: (leagueId: string, venue: LeagueVenue) => Promise<void>;
  removeLeagueVenue: (leagueId: string, venueId: string) => Promise<void>;
}

export const useLeagueVenueStore = create<LeagueVenueStore>((set, get) => ({
  venues: [],
  leagueId: null,
  loading: true,

  subscribe: (leagueId) => {
    // If already subscribed to this league, no-op
    if (get().leagueId === leagueId && !get().loading) {
      return () => {};
    }
    set({ leagueId, loading: true });
    const unsub = onSnapshot(
      collection(db, 'leagues', leagueId, 'venues'),
      (snap) => {
        const venues = snap.docs
          .map(d => ({ ...d.data(), id: d.id }) as LeagueVenue)
          .filter(v => !v.deletedAt)
          .sort((a, b) => a.importedAt.localeCompare(b.importedAt));
        set({ venues, loading: false });
      },
      () => set({ loading: false }),
    );
    return unsub;
  },

  importVenue: async (leagueId, source, lmUid) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const leagueVenue: LeagueVenue = {
      ...source,
      id,
      sourceVenueId: source.id,
      importedBy: lmUid,
      importedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(doc(db, 'leagues', leagueId, 'venues', id), leagueVenue);
    return leagueVenue;
  },

  updateLeagueVenue: async (leagueId, venue) => {
    await setDoc(
      doc(db, 'leagues', leagueId, 'venues', venue.id),
      { ...venue, updatedAt: new Date().toISOString() },
    );
  },

  // Soft-delete only — never hard-delete (would break event references)
  removeLeagueVenue: async (leagueId, venueId) => {
    await updateDoc(doc(db, 'leagues', leagueId, 'venues', venueId), {
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  },
}));
