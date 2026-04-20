export type DivisionScheduleStatus = 'none' | 'draft' | 'published';

export interface DivisionSurfacePreference {
  venueId: string;
  surfaceId: string;      // VenueField.id
  surfaceName: string;    // denormalized for display
  preference: 'required' | 'preferred';
}

export interface Division {
  id: string;
  name: string;
  teamIds: string[];
  scheduleStatus: DivisionScheduleStatus;
  /** Number of game pairings the algorithm couldn't place when the draft was saved. */
  unscheduledCount?: number;
  seasonId: string;
  createdAt: string;
  updatedAt: string;
  format?: 'single_round_robin' | 'double_round_robin';
  gamesPerTeam?: number;
  matchDurationMinutes?: number;
  surfacePreferences?: DivisionSurfacePreference[];
}
