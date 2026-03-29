export type AbsenceType = 'injury' | 'illness' | 'personal' | 'vacation' | 'suspension' | 'other';
export type AbsenceStatus = 'active' | 'resolved';

export interface Absence {
  id: string;
  teamId: string;
  playerId: string;
  playerName: string;
  type: AbsenceType;
  status: AbsenceStatus;
  startDate: string;   // ISO date
  endDate: string;     // ISO date
  note?: string;
  resolvedAt?: string; // ISO timestamp — set when absence is resolved
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
