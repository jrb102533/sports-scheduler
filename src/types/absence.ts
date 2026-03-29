export type AbsenceType = 'injury' | 'illness' | 'personal' | 'vacation' | 'suspension' | 'other';
export type AbsenceStatus = 'active' | 'resolved';

export interface Absence {
  id: string;
  teamId: string;
  playerId: string;
  playerName: string;
  type: AbsenceType;
  status: AbsenceStatus;
  startDate: string;   // ISO date yyyy-MM-dd
  endDate: string;     // Expected return date, ISO date yyyy-MM-dd
  note?: string;       // Coach-only private note
  resolvedAt?: string; // ISO datetime — set when absence is resolved / coach closes early
  createdBy: string;   // Coach uid
  createdAt: string;   // ISO datetime
  updatedAt: string;
}
