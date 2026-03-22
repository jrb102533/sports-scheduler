export type EventType = 'game' | 'match' | 'practice' | 'tournament' | 'other';
export type EventStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'postponed';

export interface GameResult {
  homeScore: number;
  awayScore: number;
  notes?: string;
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
  createdAt: string;
  updatedAt: string;
}
