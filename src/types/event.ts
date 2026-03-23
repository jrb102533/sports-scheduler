export type EventType = 'game' | 'match' | 'practice' | 'tournament' | 'other';
export type EventStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'postponed';
export type AttendanceStatus = 'present' | 'absent' | 'excused';
export type RecurrenceFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface GameResult {
  homeScore: number;
  awayScore: number;
  notes?: string;
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
  createdAt: string;
  updatedAt: string;
}
