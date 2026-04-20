import type { WizardMode, ScheduleConstraint, RecurringVenueWindow } from './wizard';

export interface VenueFieldConfig {
  id: string;
  name: string;
  /** Per-surface availability override; inherits from venue if absent. */
  availabilityWindows?: RecurringVenueWindow[];
  blackoutDates?: string[];
}

export interface ScheduleDivisionConfig {
  divisionId: string;
  surfacePreferences?: Array<{
    venueId: string;
    surfaceId: string;
    preference: 'required' | 'preferred';
  }>;
}

/** Per-venue scheduling configuration stored at the schedule level (not on the venue). */
export interface ScheduleVenueConfig {
  venueId: string;              // reference to the saved venue (or '' for manual entry)
  name: string;
  /** @deprecated — use surfaces instead */
  concurrentPitches?: number;
  availableDays?: string[];
  availableTimeStart?: string;
  availableTimeEnd?: string;
  availabilityWindows?: RecurringVenueWindow[];
  blackoutDates?: string[];
  surfaces?: VenueFieldConfig[];
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
  divisionConfigs?: ScheduleDivisionConfig[];

  // Season-level blackout dates
  seasonBlackouts: string[];

  // Teams included in this schedule
  teamIds: string[];

  // Availability collection reference
  availabilityOption: 'skip' | 'collect';
  collectionId?: string;

  // Resume support — the wizard step active when this config was saved
  currentStep?: string;

  // Timestamps
  createdAt: string;
  createdBy: string;
}
