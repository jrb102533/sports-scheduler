import { describe, it, expect } from 'vitest';
import { computeStandings } from '@/lib/standingsUtils';
import type { ScheduledEvent, Team } from '@/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTeam(id: string, name: string): Team {
  return {
    id,
    name,
    sportType: 'soccer',
    color: '#000000',
    coachName: '',
    coachEmail: '',
    coachPhone: '',
    ageGroup: 'U12',
    createdBy: 'user1',
    ownerName: 'Test Owner',
    isDeleted: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as Team;
}

function makeGame(
  id: string,
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number,
  awayScore: number,
  type: 'game' | 'match' = 'game'
): ScheduledEvent {
  return {
    id,
    title: `${homeTeamId} vs ${awayTeamId}`,
    type,
    status: 'completed',
    date: '2024-05-01',
    startTime: '10:00',
    endTime: '11:00',
    location: 'Field 1',
    homeTeamId,
    awayTeamId,
    teamIds: [homeTeamId, awayTeamId],
    result: { homeScore, awayScore, notes: '' },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as ScheduledEvent;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('computeStandings', () => {
  it('returns an empty array when there are no teams', () => {
    expect(computeStandings([], [])).toEqual([]);
  });

  it('initialises all teams at zero when no games have been played', () => {
    const teams = [makeTeam('t1', 'Lions'), makeTeam('t2', 'Tigers')];
    const rows = computeStandings([], teams);
    expect(rows).toHaveLength(2);
    rows.forEach(r => {
      expect(r.gamesPlayed).toBe(0);
      expect(r.wins).toBe(0);
      expect(r.losses).toBe(0);
      expect(r.ties).toBe(0);
      expect(r.points).toBe(0);
      expect(r.winPercentage).toBe(0);
    });
  });

  it('awards 3 points to the winning team and 0 to the loser', () => {
    const teams = [makeTeam('t1', 'Lions'), makeTeam('t2', 'Tigers')];
    const events = [makeGame('e1', 't1', 't2', 3, 1)];
    const rows = computeStandings(events, teams);

    const lions = rows.find(r => r.teamId === 't1')!;
    const tigers = rows.find(r => r.teamId === 't2')!;

    expect(lions.wins).toBe(1);
    expect(lions.losses).toBe(0);
    expect(lions.points).toBe(3);

    expect(tigers.wins).toBe(0);
    expect(tigers.losses).toBe(1);
    expect(tigers.points).toBe(0);
  });

  it('awards 1 point to each team on a draw', () => {
    const teams = [makeTeam('t1', 'Lions'), makeTeam('t2', 'Tigers')];
    const events = [makeGame('e1', 't1', 't2', 2, 2)];
    const rows = computeStandings(events, teams);

    const lions = rows.find(r => r.teamId === 't1')!;
    const tigers = rows.find(r => r.teamId === 't2')!;

    expect(lions.ties).toBe(1);
    expect(lions.points).toBe(1);
    expect(tigers.ties).toBe(1);
    expect(tigers.points).toBe(1);
  });

  it('tracks points-for and points-against correctly', () => {
    const teams = [makeTeam('t1', 'Lions'), makeTeam('t2', 'Tigers')];
    const events = [makeGame('e1', 't1', 't2', 4, 2)];
    const rows = computeStandings(events, teams);

    const lions = rows.find(r => r.teamId === 't1')!;
    const tigers = rows.find(r => r.teamId === 't2')!;

    expect(lions.pointsFor).toBe(4);
    expect(lions.pointsAgainst).toBe(2);
    expect(lions.pointsDiff).toBe(2);

    expect(tigers.pointsFor).toBe(2);
    expect(tigers.pointsAgainst).toBe(4);
    expect(tigers.pointsDiff).toBe(-2);
  });

  it('calculates winPercentage correctly', () => {
    const teams = [makeTeam('t1', 'Lions'), makeTeam('t2', 'Tigers')];
    // t1 wins 2, loses 1
    const events = [
      makeGame('e1', 't1', 't2', 2, 0),
      makeGame('e2', 't1', 't2', 1, 0),
      makeGame('e3', 't2', 't1', 3, 0),
    ];
    const rows = computeStandings(events, teams);
    const lions = rows.find(r => r.teamId === 't1')!;
    expect(lions.gamesPlayed).toBe(3);
    expect(lions.winPercentage).toBeCloseTo(2 / 3);
  });

  it('counts "match" type events in addition to "game"', () => {
    const teams = [makeTeam('t1', 'Lions'), makeTeam('t2', 'Tigers')];
    const events = [makeGame('e1', 't1', 't2', 1, 0, 'match')];
    const rows = computeStandings(events, teams);
    const lions = rows.find(r => r.teamId === 't1')!;
    expect(lions.wins).toBe(1);
  });

  it('ignores non-completed events', () => {
    const teams = [makeTeam('t1', 'Lions'), makeTeam('t2', 'Tigers')];
    const event = { ...makeGame('e1', 't1', 't2', 3, 0), status: 'scheduled' } as ScheduledEvent;
    const rows = computeStandings([event], teams);
    rows.forEach(r => expect(r.gamesPlayed).toBe(0));
  });

  it('ignores practice/tournament event types', () => {
    const teams = [makeTeam('t1', 'Lions'), makeTeam('t2', 'Tigers')];
    const event = { ...makeGame('e1', 't1', 't2', 3, 0), type: 'practice' } as ScheduledEvent;
    const rows = computeStandings([event], teams);
    rows.forEach(r => expect(r.gamesPlayed).toBe(0));
  });

  it('ignores events where homeTeamId/awayTeamId are not in the teams list', () => {
    const teams = [makeTeam('t1', 'Lions')];
    const events = [makeGame('e1', 't1', 'unknown', 3, 0)];
    const rows = computeStandings(events, teams);
    expect(rows[0].gamesPlayed).toBe(0);
  });

  it('sorts by points descending, then winPercentage descending', () => {
    const teams = [makeTeam('t1', 'A'), makeTeam('t2', 'B'), makeTeam('t3', 'C')];
    const events = [
      makeGame('e1', 't1', 't2', 1, 0), // t1=3pts, t2=0pts
      makeGame('e2', 't1', 't3', 0, 1), // t3=3pts
      makeGame('e3', 't3', 't2', 0, 0), // t3=4pts t2=1pt
    ];
    const rows = computeStandings(events, teams);
    // t1: 3pts, 1W 1L, 50% — t3: 4pts, 1W 1T, 50% — t2: 1pt, 0W 1T 1L
    expect(rows[0].teamId).toBe('t3'); // 4 pts
    expect(rows[1].teamId).toBe('t1'); // 3 pts
    expect(rows[2].teamId).toBe('t2'); // 1 pt
  });

  it('accumulates stats across multiple games', () => {
    const teams = [makeTeam('t1', 'Lions'), makeTeam('t2', 'Tigers')];
    const events = [
      makeGame('e1', 't1', 't2', 2, 1),
      makeGame('e2', 't1', 't2', 1, 1),
      makeGame('e3', 't2', 't1', 3, 0),
    ];
    const rows = computeStandings(events, teams);
    const lions = rows.find(r => r.teamId === 't1')!;
    expect(lions.gamesPlayed).toBe(3);
    expect(lions.wins).toBe(1);
    expect(lions.losses).toBe(1);
    expect(lions.ties).toBe(1);
    expect(lions.points).toBe(4); // 3 + 1 + 0
  });
});
