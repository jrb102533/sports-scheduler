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

/**
 * A single notification recipient denormalized onto the event document.
 *
 * Populated at event write time (onEventWritten trigger) and kept fresh by
 * onTeamMembershipChanged. Consumed by sendScheduledNotifications to dispatch
 * reminders without fan-out reads at send time.
 *
 * `uid` is absent for contacts that exist only as player parent emails (no
 * First Whistle account). `email` is always required — it is the primary
 * dispatch address.
 */
export interface EventRecipient {
  uid?: string;
  email: string;
  name: string;
  type: 'coach' | 'player' | 'parent';
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
  /** ISO date string (YYYY-MM-DD) by which RSVPs are requested */
  rsvpDeadline?: string;
  /** Set to 'open' when coaches submit mismatching scores. Cleared on resolution. */
  disputeStatus?: 'open';
  /**
   * Denormalized recipient list — computed from teamIds at write time and kept
   * fresh by triggers. Consumed by sendScheduledNotifications to avoid fan-out
   * reads at dispatch time. See ADR-012 / FW-82.
   */
  recipients?: EventRecipient[];
  createdAt: string;
  updatedAt: string;
}
