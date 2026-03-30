export type SeasonStatus = 'setup' | 'active' | 'archived';
export type DistributionType = 'even' | 'uneven';

/**
 * The set of criteria that can be applied in tiebreaker resolution, in priority order.
 * - winPct:       compare win percentage (wins / games played); higher wins
 * - headToHead:   result of game(s) directly between the two tied teams; only valid for twoTeam
 * - pointsAllowed: total goals conceded; fewer wins
 */
export type TiebreakerCriterion = 'winPct' | 'headToHead' | 'pointsAllowed';

/**
 * Per-season tiebreaker configuration.
 *
 * twoTeam    — criteria applied in order when exactly 2 teams are tied on points
 * threeOrMore — criteria applied in order when 3+ teams are tied on points
 *               (headToHead is intentionally excluded here because round-robin
 *                head-to-head resolution among 3+ teams is ambiguous)
 *
 * When tiebreakerConfig is absent on a season document the following defaults apply:
 *   twoTeam:     ['winPct', 'headToHead', 'pointsAllowed']
 *   threeOrMore: ['winPct', 'pointsAllowed']
 *
 * Season-creation note: when a new season is created for a league the UI should
 * copy tiebreakerConfig from the most recent prior season as the starting default.
 * The copy logic lives in the season-creation flow (not enforced here).
 */
export interface TiebreakerConfig {
  twoTeam: ('winPct' | 'headToHead' | 'pointsAllowed')[];
  threeOrMore: ('winPct' | 'pointsAllowed')[];
}

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
  tiebreakerConfig?: TiebreakerConfig; // absent → use DEFAULT_TIEBREAKER_CONFIG
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
