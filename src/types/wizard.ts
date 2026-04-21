export type WizardMode = 'season' | 'practice' | 'playoff';

export type AvailabilityState = 'preferred' | 'available' | 'unavailable';

export interface RecurringVenueWindow {
  dayOfWeek: number; // 0 = Sunday, 1 = Monday … 6 = Saturday
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
}

export interface WizardSurface {
  id: string;
  name: string;
  availabilityWindowsOverride?: RecurringVenueWindow[];
  blackoutDatesOverride?: string[];
}

export interface WizardVenueInput {
  name: string;
  /** @deprecated — use surfaces instead */
  concurrentPitches: number;
  availabilityWindows: RecurringVenueWindow[];       // primary windows — scheduler uses these first
  fallbackWindows: RecurringVenueWindow[];           // used only when primary can't fill the schedule
  blackoutDates: string[];
  surfaces?: WizardSurface[];
}

export interface ScheduleConstraint {
  id: string;
  label: string;
  enabled: boolean;
  priority: number;
  type: 'hard' | 'soft';
}

export interface CoachAvailabilityInput {
  teamId: string;
  weeklyWindows: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    state: AvailabilityState;
    available?: boolean; // backward-compat: old submissions use boolean; new submissions write state
  }[];
  dateOverrides: {
    start: string;
    end: string;
    available: false;
    reason?: string;
  }[];
}

export type CollectionStatus = 'open' | 'closed' | 'expired';

export interface AvailabilityCollection {
  id: string;
  leagueId: string;
  dueDate: string;
  status: CollectionStatus;
  createdAt: string;
  createdBy: string;
  closedAt?: string;
}

export interface CoachAvailabilityResponse {
  coachUid: string;
  coachName: string;
  teamId: string;
  submittedAt: string;
  weeklyWindows: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    state: AvailabilityState;
    available?: boolean; // backward-compat: old submissions use boolean; new submissions write state
  }[];
  dateOverrides: {
    start: string;
    end: string;
    available: false;
    reason?: string;
  }[];
}

export interface WizardDraft {
  mode: WizardMode;
  currentStep: string;
  collectionId?: string;
  stepData: Record<string, unknown>;
  updatedAt: string;
  createdBy: string;
}

export const DEFAULT_CONSTRAINTS: ScheduleConstraint[] = [
  { id: 'HC-01', label: 'All teams play the correct number of fixtures', enabled: true, priority: 1, type: 'hard' },
  { id: 'HC-02', label: 'No venue double-booked', enabled: true, priority: 2, type: 'hard' },
  { id: 'HC-03', label: 'Minimum rest days between games per team', enabled: true, priority: 3, type: 'hard' },
  { id: 'SC-01', label: 'Prefer weekends over weekdays', enabled: true, priority: 4, type: 'soft' },
  { id: 'SC-02', label: 'Schedule within coach stated availability', enabled: true, priority: 5, type: 'soft' },
  { id: 'SC-04', label: 'Balance home and away fixtures', enabled: true, priority: 6, type: 'soft' },
  { id: 'SC-05', label: 'Avoid scheduling over practice sessions', enabled: true, priority: 7, type: 'soft' },
  { id: 'SC-06', label: 'Minimise consecutive home or away runs', enabled: true, priority: 8, type: 'soft' },
];
