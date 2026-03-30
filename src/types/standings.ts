import type { SportType } from './team';

export interface ManualRankOverride {
  rank: number;
  note: string;
  scope: 'display' | 'seeding';
  overriddenBy: string;
  overriddenAt: string;
}

export interface StandingsDocument {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  winPct: number;
  rank: number;
  updatedAt: string;
  manualRankOverride?: ManualRankOverride;
}

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
