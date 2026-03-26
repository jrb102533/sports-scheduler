export interface ScheduleParameters {
  seasonStart: string;       // "YYYY-MM-DD"
  seasonEnd: string;         // "YYYY-MM-DD"
  gameDurationMinutes: number;
  rounds: number;            // 1 = one-way, 2 = home & away
  minGapDays: number;
}

export interface LeagueSchedule {
  id: string;
  leagueId: string;
  status: 'draft' | 'published' | 'archived';
  parameters: ScheduleParameters;
  generatedAt: string;
  publishedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
