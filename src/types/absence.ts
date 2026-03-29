export type AbsenceType = 'injury' | 'suspension' | 'personal';

export interface Absence {
  id: string;
  teamId: string;
  playerId: string;
  playerName: string;
  type: AbsenceType;
  startDate: string;   // ISO date yyyy-MM-dd
  endDate: string;     // Expected return date, ISO date yyyy-MM-dd
  note?: string;       // Coach-only private note
  resolvedAt?: string; // ISO datetime — set when coach closes early
  createdBy: string;   // Coach uid
  createdAt: string;   // ISO datetime
}
