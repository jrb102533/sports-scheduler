export type SportType =
  | 'soccer' | 'basketball' | 'baseball' | 'softball'
  | 'volleyball' | 'football' | 'hockey' | 'tennis' | 'other';

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
  createdAt: string;
  updatedAt: string;
}
