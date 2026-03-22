import type { ScheduledEvent, Team, TeamStandingRow } from '@/types';

export function computeStandings(events: ScheduledEvent[], teams: Team[]): TeamStandingRow[] {
  const rows: Record<string, TeamStandingRow> = {};

  for (const team of teams) {
    rows[team.id] = {
      teamId: team.id,
      teamName: team.name,
      teamColor: team.color,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointsDiff: 0,
      points: 0,
      winPercentage: 0,
    };
  }

  const gameEvents = events.filter(
    e => (e.type === 'game' || e.type === 'match') &&
      e.status === 'completed' &&
      e.result != null &&
      e.homeTeamId != null &&
      e.awayTeamId != null
  );

  for (const event of gameEvents) {
    const { homeTeamId, awayTeamId, result } = event;
    if (!homeTeamId || !awayTeamId || !result) continue;

    const home = rows[homeTeamId];
    const away = rows[awayTeamId];
    if (!home || !away) continue;

    home.gamesPlayed++;
    away.gamesPlayed++;
    home.pointsFor += result.homeScore;
    home.pointsAgainst += result.awayScore;
    away.pointsFor += result.awayScore;
    away.pointsAgainst += result.homeScore;

    if (result.homeScore > result.awayScore) {
      home.wins++;
      away.losses++;
      home.points += 3;
    } else if (result.awayScore > result.homeScore) {
      away.wins++;
      home.losses++;
      away.points += 3;
    } else {
      home.ties++;
      away.ties++;
      home.points += 1;
      away.points += 1;
    }
  }

  return Object.values(rows).map(row => ({
    ...row,
    pointsDiff: row.pointsFor - row.pointsAgainst,
    winPercentage: row.gamesPlayed > 0 ? row.wins / row.gamesPlayed : 0,
  })).sort((a, b) => b.points - a.points || b.winPercentage - a.winPercentage);
}
