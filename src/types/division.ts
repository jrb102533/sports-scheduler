export type DivisionScheduleStatus = 'none' | 'draft' | 'published';

export interface Division {
  id: string;
  name: string;
  teamIds: string[];
  scheduleStatus: DivisionScheduleStatus;
  seasonId: string;
  createdAt: string;
  updatedAt: string;
}
