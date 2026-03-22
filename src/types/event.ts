export type EventType = 'game' | 'match' | 'practice' | 'tournament' | 'other';
export type EventStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'postponed';
export type AttendanceStatus = 'present' | 'absent' | 'excused';

export interface GameResult {
  homeScore: number;
  awayScore: number;
  notes?: string;
}

export interface SnackVolunteer {
  name: string;
  bringing: string;
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
  teamIds: string[];
  result?: GameResult;
  notes?: string;
  isRecurring: boolean;
  recurringGroupId?: string;
  snackVolunteer?: SnackVolunteer;
  attendance?: AttendanceRecord[];
  attendanceRecorded?: boolean;
  createdAt: string;
  updatedAt: string;
}
