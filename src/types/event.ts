export type EventType = 'game' | 'match' | 'practice' | 'tournament' | 'other';
export type EventStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'postponed' | 'draft';
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
  /** References users/{ownerUid}/venues/{venueId} OR leagues/{leagueId}/venues/{venueId} */
  venueId?: string;
  /** References VenueField.id within the resolved venue — set by wizard auto-assignment or manual event edit */
  fieldId?: string;
  /** Denormalized field name for display without store lookup */
  fieldName?: string;
  /** Latitude of the venue — stamped directly onto the event at publish time for weather lookups */
  venueLat?: number;
  /** Longitude of the venue — stamped directly onto the event at publish time for weather lookups */
  venueLng?: number;
  /** References leagues/{leagueId} — set when generated via Schedule Wizard (enables server-side publish query) */
  leagueId?: string;
  /** References leagues/{leagueId}/seasons/{seasonId} — set when generated via Schedule Wizard */
  seasonId?: string;
  /** References leagues/{leagueId}/divisions/{divisionId} — set when generated for a division */
  divisionId?: string;
  /** Set to 'open' when coaches submit mismatching scores. Cleared on resolution. */
  disputeStatus?: 'open';
  createdAt: string;
  updatedAt: string;
}
