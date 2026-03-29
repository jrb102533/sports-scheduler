export type SeasonStatus = 'setup' | 'active' | 'archived';
export type DistributionType = 'even' | 'uneven';

export interface Season {
  id: string;
  name: string;                        // e.g. "Spring 2026"
  startDate: string;                   // ISO date "2026-03-01"
  endDate: string;                     // ISO date "2026-06-30"
  gamesPerTeam: number;
  homeAwayBalance: boolean;            // default true
  status: SeasonStatus;
  distributionType?: DistributionType; // set when schedule is generated
  randomNonce?: string;
  priorSeasonId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
