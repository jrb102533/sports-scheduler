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
  homeVenue?: string;
  coachName?: string;
  coachEmail?: string;
  coachPhone?: string;
  ageGroup?: AgeGroup;
  createdBy: string;
  ownerName: string;
  coachId?: string;
  leagueId?: string;   // optional: id of the league this team belongs to
  attendanceWarningThreshold?: number;  // undefined = use sport default
  attendanceWarningsEnabled?: boolean;  // undefined = true (warnings on by default)
  isDeleted?: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}
