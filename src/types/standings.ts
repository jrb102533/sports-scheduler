import type { SportType } from './team';

export interface TeamStandingRow {
  teamId: string;
  teamName: string;
  teamColor: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  pointsDiff: number;
  points: number;
  winPercentage: number;
}

export interface StandingsFilter {
  sportType?: SportType;
  teamIds?: string[];
}
