import type { WizardMode, ScheduleConstraint, RecurringVenueWindow } from './wizard';

/** Per-venue scheduling configuration stored at the schedule level (not on the venue). */
export interface ScheduleVenueConfig {
  venueId: string;              // reference to the saved venue (or '' for manual entry)
  name: string;
  concurrentPitches?: number;
  availableDays?: string[];
  availableTimeStart?: string;
  availableTimeEnd?: string;
  availabilityWindows?: RecurringVenueWindow[];
  blackoutDates?: string[];
}

/**
 * Full wizard configuration persisted to:
 *   leagues/{leagueId}/seasons/{seasonId}/scheduleConfig/{configId}
 *
 * Written on Publish or Save as Draft. The most recent doc is loaded
 * when the wizard reopens for the same season.
 */
export interface ScheduleConfig {
  id: string;
  mode: WizardMode;

  // Season / date range
  seasonStart: string;
  seasonEnd: string;
  matchDuration: number;       // minutes
  bufferMinutes: number;
  gamesPerTeam: number;
  homeAwayBalance: boolean;

  // Format
  format: string;              // 'single_round_robin' | 'double_round_robin' | ...
  playoffFormat?: string;      // only for playoff mode
  groupCount?: number;
  groupAdvance?: number;

  // Scheduling constraints
  minRestDays: number;
  maxConsecAway: number;
  constraints: ScheduleConstraint[];

  // Venues (per-venue availability at schedule level)
  venueConfigs: ScheduleVenueConfig[];

  // Season-level blackout dates
  seasonBlackouts: string[];

  // Teams included in this schedule
  teamIds: string[];

  // Availability collection reference
  availabilityOption: 'skip' | 'collect';
  collectionId?: string;

  // Timestamps
  createdAt: string;
  createdBy: string;
}
