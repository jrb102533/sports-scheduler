export type EventType = 'game' | 'match' | 'practice' | 'tournament' | 'other';
export type EventStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'postponed';
export type AttendanceStatus = 'present' | 'absent' | 'excused';
export type RecurrenceFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface GameResult {
  homeScore: number;
  awayScore: number;
  notes?: string;
  placement?: string;
}

export interface SnackVolunteer {
  name: string;
  bringing: string;
}

export interface SnackSignup {
  id: string;
  name: string;
  bringing: string;
  signedUpAt: string;
}

export interface EventRsvp {
  playerId: string;
  name: string;
  email: string;
  response: 'yes' | 'no' | 'maybe';
  respondedAt: string;
}

export interface AttendanceRecord {
  playerId: string;
  status: AttendanceStatus;
}

export interface ScheduledEvent {
  id: string;
  title: string;
  type: EventType;
  status: EventStatus;
  date: string;
  startTime: string;
  /** Duration in minutes. Required on new events; absent on legacy docs. */
  duration?: number;
  /** Computed from startTime + duration on save. Always present on new events. */
  endTime?: string;
  location?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  opponentId?: string;
  opponentName?: string;
  teamIds: string[];
  result?: GameResult;
  notes?: string;
  isRecurring: boolean;
  recurringGroupId?: string;
  recurrence?: RecurrenceFrequency;
  recurrenceEnd?: string;
  snackVolunteer?: SnackVolunteer;
  snackItem?: string;
  snackSignups?: SnackSignup[];
  rsvps?: EventRsvp[];
  attendance?: AttendanceRecord[];
  attendanceRecorded?: boolean;
  /** True if the event is held outdoors (default true). Set to false for indoor venues. */
  isOutdoor?: boolean;
  /** Set to true once a weather alert notification has been sent for this event. */
  weatherAlertSent?: boolean;
  /** References users/{ownerUid}/venues/{venueId} — set on publish if wizard venue is selected from library */
  venueId?: string;
  /** ownerUid of the venue document — stored alongside venueId at publish time to allow O(1) venue lookup */
  venueOwnerUid?: string;
  createdAt: string;
  updatedAt: string;
}
