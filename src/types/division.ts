export type DivisionScheduleStatus = 'none' | 'draft' | 'published';

export interface Division {
  id: string;
  name: string;
  teamIds: string[];
  scheduleStatus: DivisionScheduleStatus;
  /** Number of game pairings the algorithm couldn't place when the draft was saved. */
  unscheduledCount?: number;
  seasonId: string;
  createdAt: string;
  updatedAt: string;
}
