export type SportType =
  | 'soccer' | 'basketball' | 'baseball' | 'softball'
  | 'volleyball' | 'football' | 'hockey' | 'tennis' | 'other';

export type AgeGroup = 'U6' | 'U8' | 'U10' | 'U12' | 'U14' | 'U16' | 'U18' | 'adult';

export interface Team {
  id: string;
  name: string;
  sportType: SportType;
  color: string;
  logoUrl?: string;
  homeVenue?: string;      // kept — existing string label
  homeVenueId?: string;   // new — references users/{uid}/venues/{venueId}
  coachName?: string;
  coachEmail?: string;
  coachPhone?: string;
  ageGroup?: AgeGroup;
  createdBy: string;
  ownerName: string;
  coachId?: string;
  coachIds?: string[];  // Denormalized access list. Present on all docs after Phase 1 backfill.
  leagueIds?: string[]; // optional: ids of the leagues this team belongs to
  _managedLeagueId?: string; // internal: last league added/removed by an LM (auth hint for Firestore rules)
  isPending?: boolean;
  pendingEmail?: string;
  attendanceWarningThreshold?: number;  // undefined = use sport default
  attendanceWarningsEnabled?: boolean;  // undefined = true (warnings on by default)
  isPrivate?: boolean;
  isDeleted?: boolean;
  deletedAt?: string;
  /** Denormalized: set by onTeamMessageCreated CF. Used for unread dot detection. */
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
}
