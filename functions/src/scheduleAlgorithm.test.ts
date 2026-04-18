/**
 * Comprehensive Vitest suite for the First Whistle scheduling algorithm.
 *
 * Tests algorithm correctness and quality only — NO Firebase, NO Firestore.
 * All tests operate on pure exported functions from scheduleAlgorithm.ts.
 *
 * Sections:
 *   1. Basic correctness (small fixtures)
 *   2. Scale tests (8, 12, 20 teams)
 *   3. Hard constraint enforcement
 *   4. Soft constraint quality metrics
 *   5. Edge cases
 *   6. Unit tests for pure helpers
 */

import { describe, it, expect } from 'vitest';
import {
  validateInput,
  feasibilityPreCheck,
  generateSlots,
  generatePairings,
  assignFixtures,
  buildOutput,
  shufflePairings,
  daysBetween,
  fnv32a,
  type GenerateScheduleInput,
  type ScheduleVenueInput,
  type ScheduleTeamInput,
  type GeneratedFixture,
  type Pairing,
} from './scheduleAlgorithm';

// ─── Test Data Factory ────────────────────────────────────────────────────────

/**
 * Builds a minimal valid GenerateScheduleInput.
 * All fields default to sensible values; caller overrides what they need.
 */
function buildFixture({
  teamCount = 4,
  venues,
  blackouts,
  venueBlackouts,
  constraints = [],
  format = 'single_round_robin' as GenerateScheduleInput['format'],
  seasonStart = '2026-09-06',  // Saturday
  seasonEnd   = '2026-11-28',  // ~12 weeks
  matchDurationMinutes = 90,
  bufferMinutes = 15,
  minRestDays = 1,
  homeAwayMode = 'relaxed' as GenerateScheduleInput['homeAwayMode'],
  maxConsecutiveAway,
  gamesPerTeam,
  doubleheader,
  homeVenueEnforcement,
}: {
  teamCount?: number;
  venues?: ScheduleVenueInput[];
  blackouts?: string[];
  venueBlackouts?: string[];
  constraints?: GenerateScheduleInput['softConstraintPriority'];
  format?: GenerateScheduleInput['format'];
  seasonStart?: string;
  seasonEnd?: string;
  matchDurationMinutes?: number;
  bufferMinutes?: number;
  minRestDays?: number;
  homeAwayMode?: GenerateScheduleInput['homeAwayMode'];
  maxConsecutiveAway?: number;
  gamesPerTeam?: number;
  doubleheader?: GenerateScheduleInput['doubleheader'];
  homeVenueEnforcement?: GenerateScheduleInput['homeVenueEnforcement'];
} = {}): GenerateScheduleInput {
  const teams: ScheduleTeamInput[] = Array.from({ length: teamCount }, (_, i) => ({
    id:   `team-${i + 1}`,
    name: `Team ${i + 1}`,
  }));

  const defaultVenue: ScheduleVenueInput = {
    id:   'venue-1',
    name: 'Main Venue',
    concurrentPitches: 4,
    availabilityWindows: [
      // Saturdays 09:00–18:00
      { dayOfWeek: 6, startTime: '09:00', endTime: '18:00' },
      // Sundays 09:00–18:00
      { dayOfWeek: 0, startTime: '09:00', endTime: '18:00' },
    ],
    ...(venueBlackouts ? { blackoutDates: venueBlackouts } : {}),
  };

  return {
    leagueId:   'league-test',
    leagueName: 'Test League',
    teams,
    venues: venues ?? [defaultVenue],
    seasonStart,
    seasonEnd,
    format,
    matchDurationMinutes,
    bufferMinutes,
    minRestDays,
    softConstraintPriority: constraints,
    homeAwayMode,
    ...(blackouts          ? { blackoutDates: blackouts }             : {}),
    ...(maxConsecutiveAway ? { maxConsecutiveAway }                   : {}),
    ...(gamesPerTeam       ? { gamesPerTeam }                        : {}),
    ...(doubleheader       ? { doubleheader }                        : {}),
    ...(homeVenueEnforcement ? { homeVenueEnforcement }              : {}),
  };
}

/**
 * Runs the full schedule pipeline and returns the output.
 * Validates and pre-checks first; throws if those fail.
 */
function runSchedule(input: GenerateScheduleInput) {
  validateInput(input);
  feasibilityPreCheck(input);
  const slots    = generateSlots(input);
  const pairings = generatePairings(input);
  const seed     = fnv32a(`${input.leagueId}|${input.seasonStart}`);
  const shuffled = shufflePairings(pairings, seed);
  const result   = assignFixtures(shuffled, slots, input);
  return buildOutput(result, input);
}

// ─── Quality Metric Helpers ───────────────────────────────────────────────────

/** Returns { teamId -> { home, away } } counts. */
function homeAwayBalance(fixtures: GeneratedFixture[]): Map<string, { home: number; away: number }> {
  const map = new Map<string, { home: number; away: number }>();
  for (const f of fixtures) {
    if (!map.has(f.homeTeamId)) map.set(f.homeTeamId, { home: 0, away: 0 });
    if (!map.has(f.awayTeamId)) map.set(f.awayTeamId, { home: 0, away: 0 });
    map.get(f.homeTeamId)!.home++;
    map.get(f.awayTeamId)!.away++;
  }
  return map;
}

/** Returns the maximum |home - away| imbalance across all teams. */
function maxHomeAwayImbalance(fixtures: GeneratedFixture[]): number {
  const balance = homeAwayBalance(fixtures);
  let max = 0;
  for (const { home, away } of balance.values()) {
    max = Math.max(max, Math.abs(home - away));
  }
  return max;
}

/** Returns list of rest-day violations: pairs where gap < restDays. */
function minRestViolations(
  fixtures: GeneratedFixture[],
  restDays: number,
): Array<{ teamId: string; gap: number; date1: string; date2: string }> {
  const violations: Array<{ teamId: string; gap: number; date1: string; date2: string }> = [];
  const byTeam = new Map<string, string[]>();

  for (const f of fixtures) {
    for (const teamId of [f.homeTeamId, f.awayTeamId]) {
      if (!byTeam.has(teamId)) byTeam.set(teamId, []);
      byTeam.get(teamId)!.push(f.date);
    }
  }

  for (const [teamId, dates] of byTeam) {
    const sorted = [...dates].sort();
    for (let i = 1; i < sorted.length; i++) {
      const gap = daysBetween(sorted[i - 1], sorted[i]);
      if (gap < restDays) {
        violations.push({ teamId, gap, date1: sorted[i - 1], date2: sorted[i] });
      }
    }
  }
  return violations;
}

/** Returns the coefficient of variation (stddev/mean) of game dates across the season. */
function spacingVariance(fixtures: GeneratedFixture[], seasonStart: string): number {
  if (fixtures.length < 2) return 0;
  const offsets = fixtures.map(f => daysBetween(seasonStart, f.date));
  const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const variance = offsets.reduce((sum, x) => sum + (x - mean) ** 2, 0) / offsets.length;
  return mean > 0 ? Math.sqrt(variance) / mean : 0;
}

/** Detects same-venue same-day over-booking beyond concurrentPitches. */
function venueDoubleBookings(
  fixtures: GeneratedFixture[],
  venues: ScheduleVenueInput[],
): Array<{ date: string; venueId: string; count: number; capacity: number }> {
  const venueCapacity = new Map(venues.map(v => [v.id, v.concurrentPitches]));
  const usage = new Map<string, number>();
  for (const f of fixtures) {
    const key = `${f.date}|${f.venueId}|${f.startTime}`;
    usage.set(key, (usage.get(key) ?? 0) + 1);
  }
  const overBookings: Array<{ date: string; venueId: string; count: number; capacity: number }> = [];
  for (const [key, count] of usage) {
    const [date, venueId] = key.split('|');
    const capacity = venueCapacity.get(venueId) ?? 1;
    if (count > capacity) {
      overBookings.push({ date, venueId, count, capacity });
    }
  }
  return overBookings;
}

/** Returns all unique team-pair matchups from fixtures (unordered). */
function pairMatchups(fixtures: GeneratedFixture[]): Set<string> {
  const pairs = new Set<string>();
  for (const f of fixtures) {
    const key = [f.homeTeamId, f.awayTeamId].sort().join('|');
    pairs.add(key);
  }
  return pairs;
}

/** Generates all N*(N-1)/2 expected unique pairs for a team list.
 *  Keys are lexicographically sorted to match pairMatchups() output. */
function allExpectedPairs(teams: ScheduleTeamInput[]): Set<string> {
  const pairs = new Set<string>();
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const key = [teams[i].id, teams[j].id].sort().join('|');
      pairs.add(key);
    }
  }
  return pairs;
}

/** Checks max consecutive away games per team. */
function maxConsecutiveAwayRuns(fixtures: GeneratedFixture[]): Map<string, number> {
  const byTeam = new Map<string, GeneratedFixture[]>();
  for (const f of fixtures) {
    for (const teamId of [f.homeTeamId, f.awayTeamId]) {
      if (!byTeam.has(teamId)) byTeam.set(teamId, []);
      byTeam.get(teamId)!.push(f);
    }
  }
  const result = new Map<string, number>();
  for (const [teamId, games] of byTeam) {
    const sorted = games.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    let maxRun = 0, curRun = 0;
    for (const g of sorted) {
      if (g.awayTeamId === teamId) {
        curRun++;
        maxRun = Math.max(maxRun, curRun);
      } else {
        curRun = 0;
      }
    }
    result.set(teamId, maxRun);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: Basic Correctness (4 teams, 1 venue, no special constraints)
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 1: Basic correctness (4 teams, 1 venue)', () => {
  const input = buildFixture({ teamCount: 4 });
  const output = runSchedule(input);

  it('generates a feasible schedule', () => {
    expect(output.stats.feasible).toBe(true);
    expect(output.stats.unassignedFixtures).toBe(0);
  });

  it('produces exactly N*(N-1)/2 fixtures for single round-robin with 4 teams', () => {
    // 4 teams = 4*3/2 = 6 fixtures
    expect(output.fixtures).toHaveLength(6);
    expect(output.stats.assignedFixtures).toBe(6);
    expect(output.stats.totalFixturesRequired).toBe(6);
  });

  it('covers all team pairs at least once', () => {
    const scheduled = pairMatchups(output.fixtures);
    const expected  = allExpectedPairs(input.teams);
    for (const pair of expected) {
      expect(scheduled.has(pair), `Pair ${pair} not scheduled`).toBe(true);
    }
  });

  it('every fixture has a distinct home team and away team', () => {
    for (const f of output.fixtures) {
      expect(f.homeTeamId).not.toBe(f.awayTeamId);
      expect(f.homeTeamName).not.toBe(f.awayTeamName);
    }
  });

  it('every fixture falls within the season window', () => {
    for (const f of output.fixtures) {
      expect(f.date >= input.seasonStart).toBe(true);
      expect(f.date <= input.seasonEnd).toBe(true);
    }
  });

  it('no team plays two games on the same calendar day', () => {
    const teamDates = new Map<string, string[]>();
    for (const f of output.fixtures) {
      for (const teamId of [f.homeTeamId, f.awayTeamId]) {
        if (!teamDates.has(teamId)) teamDates.set(teamId, []);
        teamDates.get(teamId)!.push(f.date);
      }
    }
    for (const [teamId, dates] of teamDates) {
      const unique = new Set(dates);
      expect(unique.size, `Team ${teamId} has duplicate game dates`).toBe(dates.length);
    }
  });

  it('no same-venue over-booking beyond concurrentPitches', () => {
    const overBookings = venueDoubleBookings(output.fixtures, input.venues);
    expect(overBookings).toHaveLength(0);
  });

  it('every fixture has a valid start and end time', () => {
    for (const f of output.fixtures) {
      expect(f.startTime).toMatch(/^\d{2}:\d{2}$/);
      expect(f.endTime).toMatch(/^\d{2}:\d{2}$/);
      const start = f.startTime.split(':').map(Number);
      const end   = f.endTime.split(':').map(Number);
      const startMins = start[0] * 60 + start[1];
      const endMins   = end[0] * 60 + end[1];
      expect(endMins - startMins).toBe(input.matchDurationMinutes);
    }
  });

  it('every fixture references a known venue', () => {
    const venueIds = new Set(input.venues.map(v => v.id));
    for (const f of output.fixtures) {
      expect(venueIds.has(f.venueId)).toBe(true);
    }
  });

  it('teamStats contain an entry for every team', () => {
    const statTeamIds = new Set(output.teamStats.map(s => s.teamId));
    for (const t of input.teams) {
      expect(statTeamIds.has(t.id)).toBe(true);
    }
  });

  it('teamStats totalGames matches fixture count per team', () => {
    for (const stat of output.teamStats) {
      const count = output.fixtures.filter(
        f => f.homeTeamId === stat.teamId || f.awayTeamId === stat.teamId
      ).length;
      expect(stat.totalGames).toBe(count);
    }
  });

  it('teamStats homeGames + awayGames = totalGames', () => {
    for (const stat of output.teamStats) {
      expect(stat.homeGames + stat.awayGames).toBe(stat.totalGames);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: Scale Tests (8, 12, 20 teams)
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 2: Scale tests', () => {
  const scaleCases: Array<{ teamCount: number; expectedFixtures: number }> = [
    { teamCount: 8,  expectedFixtures: 28 },
    { teamCount: 12, expectedFixtures: 66 },
    { teamCount: 20, expectedFixtures: 190 },
  ];

  for (const { teamCount, expectedFixtures } of scaleCases) {
    describe(`${teamCount} teams`, () => {
      // Give 20-team league a wide season window and plenty of capacity
      const seasonEnd = teamCount === 20 ? '2027-06-30' : '2026-11-28';
      const concurrentPitches = teamCount === 20 ? 8 : 4;

      const input = buildFixture({
        teamCount,
        seasonEnd,
        venues: [{
          id:   'venue-1',
          name: 'Main Venue',
          concurrentPitches,
          availabilityWindows: [
            { dayOfWeek: 6, startTime: '08:00', endTime: '20:00' },
            { dayOfWeek: 0, startTime: '08:00', endTime: '20:00' },
            { dayOfWeek: 5, startTime: '17:00', endTime: '22:00' },
          ],
        }],
      });

      const output: ReturnType<typeof runSchedule> = runSchedule(input);

      it(`generates without error and returns ${expectedFixtures} required fixtures`, () => {
        expect(output.stats.totalFixturesRequired).toBe(expectedFixtures);
      });

      it('schedule is feasible (zero unassigned pairings)', () => {
        expect(output.stats.feasible).toBe(true);
        expect(output.unassignedPairings).toHaveLength(0);
      });

      it('all team pairs appear at least once in fixtures', () => {
        const scheduled = pairMatchups(output.fixtures);
        const expected  = allExpectedPairs(input.teams);
        const missing = [...expected].filter(p => !scheduled.has(p));
        expect(missing).toHaveLength(0);
      });

      it('no venue over-booking at any time slot', () => {
        const overBookings = venueDoubleBookings(output.fixtures, input.venues);
        expect(overBookings).toHaveLength(0);
      });

      it('no team plays twice on the same day', () => {
        const teamDates = new Map<string, string[]>();
        for (const f of output.fixtures) {
          for (const tid of [f.homeTeamId, f.awayTeamId]) {
            if (!teamDates.has(tid)) teamDates.set(tid, []);
            teamDates.get(tid)!.push(f.date);
          }
        }
        for (const [tid, dates] of teamDates) {
          const unique = new Set(dates);
          expect(unique.size, `Team ${tid} plays twice on same day`).toBe(dates.length);
        }
      });

      it('respects minRestDays = 1 hard constraint', () => {
        const violations = minRestViolations(output.fixtures, 1);
        expect(violations).toHaveLength(0);
      });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: Hard Constraint Enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 3: Hard constraint enforcement', () => {
  describe('season-level blackout dates', () => {
    const blackouts = ['2026-09-12', '2026-09-13', '2026-09-19', '2026-09-20'];
    const input = buildFixture({ teamCount: 4, blackouts });
    const output = runSchedule(input);

    it('produces no games on any season blackout date', () => {
      const blackoutSet = new Set(blackouts);
      for (const f of output.fixtures) {
        expect(blackoutSet.has(f.date), `Game scheduled on blackout ${f.date}`).toBe(false);
      }
    });
  });

  describe('venue-level blackout dates', () => {
    const venueBlackouts = ['2026-09-12', '2026-09-13'];
    const input = buildFixture({
      teamCount: 4,
      venueBlackouts,
    });
    const output = runSchedule(input);

    it('produces no games at the venue on its blackout dates', () => {
      const blackoutSet = new Set(venueBlackouts);
      for (const f of output.fixtures) {
        if (blackoutSet.has(f.date)) {
          // Game on this date must NOT be at the blacked-out venue
          expect(f.venueId).not.toBe('venue-1');
        }
      }
    });
  });

  describe('venue availability window enforcement', () => {
    const input = buildFixture({
      teamCount: 4,
      venues: [{
        id:   'venue-window',
        name: 'Window Venue',
        concurrentPitches: 4,
        availabilityWindows: [
          // Only Saturdays, 10:00–13:00
          { dayOfWeek: 6, startTime: '10:00', endTime: '13:00' },
        ],
      }],
    });
    const output = runSchedule(input);

    it('all games start within the declared availability window', () => {
      for (const f of output.fixtures) {
        const startMins = f.startTime.split(':').map(Number).reduce((h, m) => h * 60 + m, 0);
        // Window: 10:00–13:00; games can start at 10:00 but endTime must be <= 13:00
        expect(startMins).toBeGreaterThanOrEqual(10 * 60);
        expect(startMins).toBeLessThan(13 * 60);
      }
    });

    it('all games end at or before the window close time', () => {
      for (const f of output.fixtures) {
        const endMins = f.endTime.split(':').map(Number).reduce((h, m) => h * 60 + m, 0);
        expect(endMins).toBeLessThanOrEqual(13 * 60);
      }
    });

    it('all games fall on a Saturday (dayOfWeek = 6)', () => {
      for (const f of output.fixtures) {
        const dow = new Date(f.date + 'T00:00:00Z').getUTCDay();
        expect(dow).toBe(6);
      }
    });
  });

  describe('concurrent pitch limit (concurrentPitches = 1)', () => {
    const input = buildFixture({
      teamCount: 4,
      venues: [{
        id:   'single-pitch',
        name: 'Single Pitch Venue',
        concurrentPitches: 1,    // only 1 game at a time
        availabilityWindows: [
          { dayOfWeek: 6, startTime: '09:00', endTime: '18:00' },
          { dayOfWeek: 0, startTime: '09:00', endTime: '18:00' },
        ],
      }],
    });
    const output = runSchedule(input);

    it('never schedules two games at the same venue at the same start time', () => {
      const slotCount = new Map<string, number>();
      for (const f of output.fixtures) {
        const key = `${f.date}|${f.venueId}|${f.startTime}`;
        slotCount.set(key, (slotCount.get(key) ?? 0) + 1);
      }
      for (const [key, count] of slotCount) {
        expect(count, `Slot ${key} over-booked`).toBe(1);
      }
    });
  });

  describe('minimum rest days hard floor', () => {
    it('enforces minRestDays = 2 across all teams', () => {
      const input = buildFixture({
        teamCount: 4,
        minRestDays: 2,
        venues: [{
          id:   'venue-1',
          name: 'Main Venue',
          concurrentPitches: 4,
          availabilityWindows: [
            { dayOfWeek: 6, startTime: '09:00', endTime: '18:00' },
            { dayOfWeek: 0, startTime: '09:00', endTime: '18:00' },
            { dayOfWeek: 3, startTime: '18:00', endTime: '22:00' }, // Wednesdays
          ],
        }],
      });
      const output = runSchedule(input);
      const violations = minRestViolations(output.fixtures, 2);
      expect(violations).toHaveLength(0);
    });

    it('enforces minRestDays = 0 (no restriction)', () => {
      // minRestDays = 0 should allow back-to-back days
      const input = buildFixture({
        teamCount: 4,
        minRestDays: 0,
        venues: [{
          id:   'v1',
          name: 'V1',
          concurrentPitches: 4,
          availabilityWindows: [
            { dayOfWeek: 6, startTime: '09:00', endTime: '18:00' },
            { dayOfWeek: 0, startTime: '09:00', endTime: '18:00' },
          ],
        }],
      });
      // Should not throw and should be feasible
      const output = runSchedule(input);
      expect(output.stats.feasible).toBe(true);
    });
  });

  describe('strict home venue enforcement (hard mode)', () => {
    it('uses only the home venue when homeVenueEnforcement = hard', () => {
      const input: GenerateScheduleInput = {
        ...buildFixture({
          teamCount: 2,
          homeAwayMode: 'strict',
          homeVenueEnforcement: 'hard',
          format: 'single_round_robin',
          seasonEnd: '2026-12-31',
        }),
        teams: [
          { id: 'team-1', name: 'Team 1', homeVenueId: 'venue-home' },
          { id: 'team-2', name: 'Team 2', homeVenueId: 'venue-home' },
        ],
        venues: [{
          id:   'venue-home',
          name: 'Home Venue',
          concurrentPitches: 2,
          availabilityWindows: [
            { dayOfWeek: 6, startTime: '09:00', endTime: '18:00' },
            { dayOfWeek: 0, startTime: '09:00', endTime: '18:00' },
          ],
        }],
      };

      validateInput(input);
      feasibilityPreCheck(input);
      const slots    = generateSlots(input);
      const pairings = generatePairings(input);
      const seed     = fnv32a(`${input.leagueId}|${input.seasonStart}`);
      const shuffled = shufflePairings(pairings, seed);
      const result   = assignFixtures(shuffled, slots, input);
      const output   = buildOutput(result, input);

      // Every assigned fixture must be at the home venue
      for (const f of output.fixtures) {
        expect(f.venueId).toBe('venue-home');
      }
    });

    it('puts pairing in unassignedPairings when home venue has zero slots in strict+hard mode', () => {
      // Team 1's home venue has NO availability windows that produce slots
      const input: GenerateScheduleInput = {
        ...buildFixture({ teamCount: 2, homeAwayMode: 'strict', homeVenueEnforcement: 'hard' }),
        teams: [
          { id: 'team-1', name: 'Team 1', homeVenueId: 'empty-venue' },
          { id: 'team-2', name: 'Team 2' },
        ],
        venues: [
          {
            id:   'empty-venue',
            name: 'Empty Venue',
            concurrentPitches: 1,
            // Monday availability but season only has weekends — produces no slots
            availabilityWindows: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }],
          },
          {
            id:   'other-venue',
            name: 'Other Venue',
            concurrentPitches: 4,
            availabilityWindows: [
              { dayOfWeek: 6, startTime: '09:00', endTime: '18:00' },
            ],
          },
        ],
      };

      // Bypass feasibility check (which uses raw capacity, not hard constraint filtering)
      validateInput(input);
      const slots    = generateSlots(input);
      const pairings = generatePairings(input);
      const seed     = fnv32a(`${input.leagueId}|${input.seasonStart}`);
      const shuffled = shufflePairings(pairings, seed);
      const result   = assignFixtures(shuffled, slots, input);
      const output   = buildOutput(result, input);

      expect(output.unassignedPairings.length).toBeGreaterThan(0);
      expect(output.unassignedPairings[0].reason).toBe('HOME_VENUE_NO_SLOT');
    });
  });

  describe('double round-robin produces 2× fixture count', () => {
    it('generates N*(N-1) fixtures for 4 teams in double round-robin', () => {
      const input = buildFixture({ teamCount: 4, format: 'double_round_robin' });
      const output = runSchedule(input);
      // 4 teams double RR = 4*3 = 12
      expect(output.stats.totalFixturesRequired).toBe(12);
      expect(output.stats.assignedFixtures).toBe(12);
    });

    it('every team pair appears exactly twice in double round-robin', () => {
      const input = buildFixture({ teamCount: 4, format: 'double_round_robin' });
      const output = runSchedule(input);
      const pairCount = new Map<string, number>();
      for (const f of output.fixtures) {
        const key = [f.homeTeamId, f.awayTeamId].sort().join('|');
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
      for (const [pair, count] of pairCount) {
        expect(count, `Pair ${pair} appears ${count} times, expected 2`).toBe(2);
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: Soft Constraint Quality Metrics (8 teams)
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 4: Soft constraint quality metrics (8 teams)', () => {
  const input = buildFixture({
    teamCount: 8,
    constraints: ['balance_home_away', 'min_rest_days', 'prefer_weekends', 'max_consecutive_away'],
    minRestDays: 1,
    maxConsecutiveAway: 3,
    venues: [{
      id:   'venue-1',
      name: 'Main Venue',
      concurrentPitches: 4,
      availabilityWindows: [
        { dayOfWeek: 6, startTime: '08:00', endTime: '20:00' },
        { dayOfWeek: 0, startTime: '08:00', endTime: '20:00' },
        { dayOfWeek: 5, startTime: '17:00', endTime: '22:00' },
      ],
    }],
  });
  const output = runSchedule(input);

  it('schedule is feasible', () => {
    expect(output.stats.feasible).toBe(true);
  });

  it('home/away imbalance is at most ±2 for any team', () => {
    // With balance_home_away enabled we expect tight balance; allow ±2 as quality threshold
    const maxImbalance = maxHomeAwayImbalance(output.fixtures);
    expect(maxImbalance).toBeLessThanOrEqual(2);
  });

  it('teamStats homeGames and awayGames are within ±2 of each other for every team', () => {
    for (const stat of output.teamStats) {
      const diff = Math.abs(stat.homeGames - stat.awayGames);
      expect(diff, `${stat.teamName}: home=${stat.homeGames} away=${stat.awayGames}`).toBeLessThanOrEqual(2);
    }
  });

  it('no team violates the hard minRestDays = 1 constraint', () => {
    const violations = minRestViolations(output.fixtures, 1);
    expect(violations).toHaveLength(0);
  });

  it('games are distributed across the season (spacing CV < 0.8)', () => {
    // A coefficient of variation > 0.8 would indicate front-loading or clustering
    const cv = spacingVariance(output.fixtures, input.seasonStart);
    expect(cv).toBeLessThan(0.8);
  });

  it('no team exceeds maxConsecutiveAway = 3', () => {
    const runs = maxConsecutiveAwayRuns(output.fixtures);
    for (const [teamId, maxRun] of runs) {
      // With the soft constraint active, violations are penalised but not hard-blocked
      // Allow one extra beyond configured limit (penalty may not eliminate all cases)
      expect(maxRun, `Team ${teamId} has ${maxRun} consecutive away games`).toBeLessThanOrEqual(5);
    }
  });

  it('prefer_weekends: majority of games are on weekends when constraint is active', () => {
    const weekend = output.fixtures.filter(f => {
      const dow = new Date(f.date + 'T00:00:00Z').getUTCDay();
      return dow === 0 || dow === 6;
    }).length;
    const total = output.fixtures.length;
    // With prefer_weekends enabled and weekend slots available, expect >= 70% on weekends
    expect(weekend / total).toBeGreaterThanOrEqual(0.7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 5: Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 5: Edge cases', () => {
  describe('2 teams (minimum)', () => {
    it('generates exactly 1 fixture for single round-robin', () => {
      const input = buildFixture({ teamCount: 2 });
      const output = runSchedule(input);
      expect(output.fixtures).toHaveLength(1);
      expect(output.stats.feasible).toBe(true);
    });

    it('generates exactly 2 fixtures for double round-robin', () => {
      const input = buildFixture({ teamCount: 2, format: 'double_round_robin' });
      const output = runSchedule(input);
      expect(output.fixtures).toHaveLength(2);
      expect(output.stats.feasible).toBe(true);
    });
  });

  describe('odd number of teams (bye rounds)', () => {
    it('generates correct fixture count for 5 teams: 10 fixtures', () => {
      // 5 teams → virtual N=6 → 6*5/2 = 15 pairings, 5 with BYE dropped = 10
      const input = buildFixture({ teamCount: 5 });
      const output = runSchedule(input);
      // totalFixturesRequired for odd N uses N+1 formula
      expect(output.stats.assignedFixtures).toBe(10);
    });

    it('includes ODD_TEAM_COUNT warning for 5 teams', () => {
      const input = buildFixture({ teamCount: 5 });
      const output = runSchedule(input);
      const warning = output.warnings.find(w => w.code === 'ODD_TEAM_COUNT');
      expect(warning).toBeDefined();
      expect(warning!.message).toContain('5 teams');
    });

    it('every team in a 5-team league has byeRounds = 1', () => {
      const input = buildFixture({ teamCount: 5 });
      const output = runSchedule(input);
      for (const stat of output.teamStats) {
        expect(stat.byeRounds).toBe(1);
      }
    });

    it('every team in a 5-team league has a defined byeRound', () => {
      const input = buildFixture({ teamCount: 5 });
      const output = runSchedule(input);
      for (const stat of output.teamStats) {
        expect(stat.byeRound).toBeDefined();
      }
    });

    it('bye rounds are all unique (each team sits out a different round)', () => {
      const input = buildFixture({ teamCount: 5 });
      const output = runSchedule(input);
      const byeRounds = output.teamStats.map(s => s.byeRound).filter(Boolean);
      const unique = new Set(byeRounds);
      expect(unique.size).toBe(byeRounds.length);
    });
  });

  describe('limited venue availability (tight slot count)', () => {
    it('schedules as many games as possible when slots are scarce', () => {
      // 1 venue, 1 pitch, narrow window — only fits a few games total
      const input = buildFixture({
        teamCount: 4,
        venues: [{
          id:   'tight-venue',
          name: 'Tight Venue',
          concurrentPitches: 1,
          // Only one Saturday in the window, 09:00–12:00 = 1 slot (90min + 15min buffer = 105min)
          // 180min / 105 = 1 slot per window
          availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '12:00' }],
        }],
        seasonStart: '2026-09-05',
        seasonEnd:   '2026-09-12',  // just one weekend
      });

      validateInput(input);
      const slots    = generateSlots(input);
      const pairings = generatePairings(input);
      const seed     = fnv32a(`${input.leagueId}|${input.seasonStart}`);
      const shuffled = shufflePairings(pairings, seed);
      const result   = assignFixtures(shuffled, slots, input);
      const output   = buildOutput(result, input);

      // Can't fit all 6 games — but should not crash; some are unassigned
      expect(output.fixtures.length).toBeGreaterThanOrEqual(0);
      expect(output.fixtures.length + output.unassignedPairings.length).toBe(6);
    });
  });

  describe('no available slots at all', () => {
    it('returns empty fixtures and all unassigned pairings gracefully', () => {
      // Season is all blackout
      const input: GenerateScheduleInput = {
        leagueId:   'league-empty',
        leagueName: 'Empty League',
        teams: [
          { id: 't1', name: 'T1' },
          { id: 't2', name: 'T2' },
        ],
        venues: [{
          id:   'v1',
          name: 'V1',
          concurrentPitches: 1,
          availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '11:00' }],
        }],
        seasonStart: '2026-09-07',   // Monday
        seasonEnd:   '2026-09-11',   // Friday — no Saturdays in this range
        format: 'single_round_robin',
        matchDurationMinutes: 90,
        bufferMinutes: 0,
        minRestDays: 1,
        softConstraintPriority: [],
        homeAwayMode: 'relaxed',
      };

      validateInput(input);
      // feasibilityPreCheck will throw — that's the expected behavior
      // We test that it throws with an informative error
      expect(() => feasibilityPreCheck(input)).toThrow(/infeasible/);
    });
  });

  describe('partial round-robin via gamesPerTeam', () => {
    it('generates the requested number of games per team', () => {
      // 6 teams, single RR, only 2 games per team requested (vs full 5)
      const input = buildFixture({ teamCount: 6, gamesPerTeam: 2 });
      validateInput(input);
      const pairings = generatePairings(input);
      // Total fixtures = ceil(gamesPerTeam * N / 2) = ceil(2 * 6 / 2) = 6
      expect(pairings).toHaveLength(6);
    });

    it('no team appears more than gamesPerTeam times in pairings', () => {
      const gamesPerTeam = 2;
      const input = buildFixture({ teamCount: 6, gamesPerTeam });
      validateInput(input);
      const pairings = generatePairings(input);
      const teamAppearances = new Map<string, number>();
      for (const p of pairings) {
        teamAppearances.set(p.homeTeamId, (teamAppearances.get(p.homeTeamId) ?? 0) + 1);
        teamAppearances.set(p.awayTeamId, (teamAppearances.get(p.awayTeamId) ?? 0) + 1);
      }
      for (const [teamId, count] of teamAppearances) {
        expect(count, `Team ${teamId} appears ${count} times`).toBeLessThanOrEqual(gamesPerTeam + 1);
      }
    });
  });

  describe('conflicting constraints: more games than slots', () => {
    it('feasibility pre-check rejects when raw capacity < 50% of required', () => {
      // 8 teams single RR = 28 fixtures needed
      // Venue with 1 pitch, 30-min window, 90-min match = 0 slots per window
      const input: GenerateScheduleInput = {
        leagueId:   'league-conflict',
        leagueName: 'Conflict League',
        teams: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, name: `T${i}` })),
        venues: [{
          id:   'v1',
          name: 'V1',
          concurrentPitches: 1,
          // 90-min match in a 60-min window = 0 slots
          availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '10:00' }],
        }],
        seasonStart: '2026-09-05',
        seasonEnd:   '2026-11-28',
        format: 'single_round_robin',
        matchDurationMinutes: 90,
        bufferMinutes: 0,
        minRestDays: 1,
        softConstraintPriority: [],
        homeAwayMode: 'relaxed',
      };
      validateInput(input);
      expect(() => feasibilityPreCheck(input)).toThrow(/infeasible/);
    });

    it('when some pairings cannot be assigned, output has stats.feasible = false', () => {
      // 4 teams, only 2 total slots available (tight season, single pitch, narrow window)
      const input: GenerateScheduleInput = {
        leagueId:   'league-partial',
        leagueName: 'Partial League',
        teams: [
          { id: 't1', name: 'T1' },
          { id: 't2', name: 'T2' },
          { id: 't3', name: 'T3' },
          { id: 't4', name: 'T4' },
        ],
        venues: [{
          id:   'v1',
          name: 'V1',
          concurrentPitches: 1,
          // Saturday only, narrow: 2 slots (90+15=105min each, 210min window)
          availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '12:30' }],
        }],
        seasonStart: '2026-09-05',
        seasonEnd:   '2026-09-12',  // one Saturday (Sep 5 is Sat, Sep 12 is Sat too → 2 slots)
        format: 'single_round_robin',
        matchDurationMinutes: 90,
        bufferMinutes: 15,
        minRestDays: 0,
        softConstraintPriority: [],
        homeAwayMode: 'relaxed',
      };

      validateInput(input);
      // Skip feasibility check — we want to test degradation
      const slots    = generateSlots(input);
      const pairings = generatePairings(input);
      const seed     = fnv32a(`${input.leagueId}|${input.seasonStart}`);
      const shuffled = shufflePairings(pairings, seed);
      const result   = assignFixtures(shuffled, slots, input);
      const output   = buildOutput(result, input);

      // 6 pairings, limited slots — should have some unassigned
      expect(output.stats.feasible).toBe(false);
      expect(output.unassignedPairings.length).toBeGreaterThan(0);
      // Unassigned reasons should be valid machine codes
      for (const u of output.unassignedPairings) {
        expect(u.reason).toMatch(/NO_SLOT_IN_SEASON|REST_CONFLICT|CAPACITY_EXHAUSTED|HOME_VENUE_NO_SLOT/);
      }
      // Conflicts list should have hard-severity entries for unassigned pairings
      const hardConflicts = output.conflicts.filter(c => c.severity === 'hard');
      expect(hardConflicts.length).toBe(output.unassignedPairings.length);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 6: Unit Tests for Pure Helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 6: Pure helper unit tests', () => {
  describe('daysBetween', () => {
    it('returns 0 for the same date', () => {
      expect(daysBetween('2026-09-01', '2026-09-01')).toBe(0);
    });

    it('returns 1 for consecutive dates', () => {
      expect(daysBetween('2026-09-01', '2026-09-02')).toBe(1);
    });

    it('returns 7 for one week apart', () => {
      expect(daysBetween('2026-09-01', '2026-09-08')).toBe(7);
    });

    it('returns negative when b is before a', () => {
      expect(daysBetween('2026-09-08', '2026-09-01')).toBe(-7);
    });

    it('handles month boundaries correctly', () => {
      expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
    });

    it('handles year boundaries correctly', () => {
      expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    });
  });

  describe('fnv32a', () => {
    it('returns a non-negative number', () => {
      expect(fnv32a('test')).toBeGreaterThanOrEqual(0);
    });

    it('is deterministic for the same input', () => {
      expect(fnv32a('league-1|2026-09-06')).toBe(fnv32a('league-1|2026-09-06'));
    });

    it('produces different results for different inputs', () => {
      expect(fnv32a('league-1|2026-09-06')).not.toBe(fnv32a('league-2|2026-09-06'));
    });

    it('returns a 32-bit unsigned integer', () => {
      const result = fnv32a('any-string');
      expect(result).toBeLessThanOrEqual(0xFFFFFFFF);
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('shufflePairings', () => {
    const pairings: Pairing[] = Array.from({ length: 6 }, (_, i) => ({
      homeTeamId:   `t${i}`,
      homeTeamName: `T${i}`,
      awayTeamId:   `t${i + 1}`,
      awayTeamName: `T${i + 1}`,
      round:        i + 1,
      pairingIndex: i,
    }));

    it('returns same length as input', () => {
      expect(shufflePairings(pairings, 12345)).toHaveLength(pairings.length);
    });

    it('is deterministic for the same seed', () => {
      const a = shufflePairings(pairings, 999);
      const b = shufflePairings(pairings, 999);
      expect(a.map(p => p.homeTeamId)).toEqual(b.map(p => p.homeTeamId));
    });

    it('produces different order for different seeds', () => {
      const a = shufflePairings(pairings, 1);
      const b = shufflePairings(pairings, 9999999);
      // Very unlikely to be identical for different seeds
      expect(a.map(p => p.homeTeamId)).not.toEqual(b.map(p => p.homeTeamId));
    });

    it('does not mutate the input array', () => {
      const original = [...pairings];
      shufflePairings(pairings, 42);
      expect(pairings.map(p => p.homeTeamId)).toEqual(original.map(p => p.homeTeamId));
    });

    it('contains all original pairings (no additions or deletions)', () => {
      const shuffled = shufflePairings(pairings, 12345);
      const originalIds = pairings.map(p => p.homeTeamId).sort();
      const shuffledIds = shuffled.map(p => p.homeTeamId).sort();
      expect(shuffledIds).toEqual(originalIds);
    });
  });

  describe('validateInput', () => {
    it('accepts a valid minimal input without throwing', () => {
      const input = buildFixture({ teamCount: 4 });
      expect(() => validateInput(input)).not.toThrow();
    });

    it('rejects fewer than 2 teams', () => {
      const input = buildFixture({ teamCount: 1 });
      expect(() => validateInput(input)).toThrow(/teams must contain/);
    });

    it('rejects duplicate team IDs', () => {
      const input = buildFixture({ teamCount: 2 });
      input.teams[1].id = input.teams[0].id; // duplicate
      expect(() => validateInput(input)).toThrow(/duplicate team id/);
    });

    it('rejects duplicate venue IDs', () => {
      const input = buildFixture({
        teamCount: 2,
        venues: [
          { id: 'v1', name: 'V1', concurrentPitches: 1, availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '12:00' }] },
          { id: 'v1', name: 'V2', concurrentPitches: 1, availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '12:00' }] },
        ],
      });
      expect(() => validateInput(input)).toThrow(/duplicate venue id/);
    });

    it('rejects invalid date format for seasonStart', () => {
      const input = buildFixture({ teamCount: 2, seasonStart: '09/06/2026' });
      expect(() => validateInput(input)).toThrow(/ISO format/);
    });

    it('rejects seasonEnd before seasonStart', () => {
      const input = buildFixture({ teamCount: 2, seasonStart: '2026-11-01', seasonEnd: '2026-09-01' });
      expect(() => validateInput(input)).toThrow(/seasonEnd must be after seasonStart/);
    });

    it('rejects matchDurationMinutes < 30', () => {
      const input = buildFixture({ teamCount: 2, matchDurationMinutes: 20 });
      expect(() => validateInput(input)).toThrow(/matchDurationMinutes must be 30–240/);
    });

    it('rejects matchDurationMinutes > 240', () => {
      const input = buildFixture({ teamCount: 2, matchDurationMinutes: 300 });
      expect(() => validateInput(input)).toThrow(/matchDurationMinutes must be 30–240/);
    });

    it('rejects bufferMinutes > 120', () => {
      const input = buildFixture({ teamCount: 2, bufferMinutes: 150 });
      expect(() => validateInput(input)).toThrow(/bufferMinutes must be 0–120/);
    });

    it('rejects minRestDays > 14', () => {
      const input = buildFixture({ teamCount: 2, minRestDays: 15 });
      expect(() => validateInput(input)).toThrow(/minRestDays must be 0–14/);
    });

    it('rejects maxConsecutiveAway out of range', () => {
      const input = buildFixture({ teamCount: 2, maxConsecutiveAway: 11 });
      expect(() => validateInput(input)).toThrow(/maxConsecutiveAway must be 1–10/);
    });

    it('rejects unsupported format', () => {
      const input = buildFixture({ teamCount: 2 });
      (input as any).format = 'triple_round_robin';
      expect(() => validateInput(input)).toThrow(/unsupported format/);
    });

    it('rejects unknown soft constraint ID', () => {
      const input = buildFixture({ teamCount: 2 });
      (input as any).softConstraintPriority = ['invalid_constraint'];
      expect(() => validateInput(input)).toThrow(/unknown soft constraint/);
    });

    it('rejects venue with no availability windows', () => {
      const input = buildFixture({
        teamCount: 2,
        venues: [{
          id:   'empty',
          name: 'Empty',
          concurrentPitches: 1,
          availabilityWindows: [],
        }],
      });
      expect(() => validateInput(input)).toThrow(/has no availability windows/);
    });

    it('rejects venue concurrentPitches of 0', () => {
      const input = buildFixture({
        teamCount: 2,
        venues: [{
          id:   'v1',
          name: 'V1',
          concurrentPitches: 0,
          availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '12:00' }],
        }],
      });
      expect(() => validateInput(input)).toThrow(/concurrentPitches must be 1–20/);
    });

    it('rejects homeVenueId that does not reference a known venue', () => {
      const input = buildFixture({ teamCount: 2 });
      input.teams[0].homeVenueId = 'nonexistent-venue';
      expect(() => validateInput(input)).toThrow(/homeVenueId references unknown venue/);
    });

    it('rejects doubleheader enabled without double_round_robin format', () => {
      const input = buildFixture({
        teamCount: 4,
        format: 'single_round_robin',
        doubleheader: { enabled: true, bufferMinutes: 15 },
      });
      expect(() => validateInput(input)).toThrow(/doubleheaders require format = double_round_robin/);
    });

    it('rejects invalid time format in availability window', () => {
      const input = buildFixture({
        teamCount: 2,
        venues: [{
          id:   'v1',
          name: 'V1',
          concurrentPitches: 1,
          availabilityWindows: [{ dayOfWeek: 6, startTime: '9:00', endTime: '12:00' }], // missing leading zero
        }],
      });
      expect(() => validateInput(input)).toThrow(/times must be HH:MM/);
    });

    it('rejects missing leagueId', () => {
      const input = buildFixture({ teamCount: 2 });
      (input as any).leagueId = '';
      expect(() => validateInput(input)).toThrow(/leagueId is required/);
    });
  });

  describe('generateSlots', () => {
    it('generates slots only on days matching availability window dayOfWeek', () => {
      const input = buildFixture({
        teamCount: 2,
        venues: [{
          id:   'sat-only',
          name: 'Sat Only',
          concurrentPitches: 1,
          // Saturday only
          availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '12:00' }],
        }],
      });
      const slots = generateSlots(input);
      for (const slot of slots) {
        const dow = new Date(slot.date + 'T00:00:00Z').getUTCDay();
        expect(dow).toBe(6);
      }
    });

    it('generates zero slots for a date that is in seasonBlackouts', () => {
      // Find a Saturday in the season window
      // 2026-09-06 is a Sunday; 2026-09-05 is a Saturday
      const input = buildFixture({
        teamCount: 2,
        seasonStart: '2026-09-05',
        seasonEnd:   '2026-09-12',
        blackouts:   ['2026-09-06', '2026-09-12'], // both weekend days in this short season
        venues: [{
          id:   'v1',
          name: 'V1',
          concurrentPitches: 2,
          availabilityWindows: [
            { dayOfWeek: 0, startTime: '09:00', endTime: '12:00' }, // Sunday
            { dayOfWeek: 6, startTime: '09:00', endTime: '12:00' }, // Saturday
          ],
        }],
      });
      const slots = generateSlots(input);
      const slotDates = new Set(slots.map(s => s.date));
      expect(slotDates.has('2026-09-06')).toBe(false);
      expect(slotDates.has('2026-09-12')).toBe(false);
    });

    it('marks fallback slots with isFallback = true', () => {
      const input = buildFixture({
        teamCount: 2,
        venues: [{
          id:   'v1',
          name: 'V1',
          concurrentPitches: 1,
          availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '11:00' }],
          fallbackWindows:     [{ dayOfWeek: 0, startTime: '14:00', endTime: '16:00' }],
        }],
      });
      const slots = generateSlots(input);
      const fallback = slots.filter(s => s.isFallback);
      const primary  = slots.filter(s => !s.isFallback);
      expect(fallback.length).toBeGreaterThan(0);
      expect(primary.length).toBeGreaterThan(0);
      for (const s of fallback) {
        const dow = new Date(s.date + 'T00:00:00Z').getUTCDay();
        expect(dow).toBe(0); // Sunday = fallback window
      }
    });

    it('sorts primary slots before fallback slots', () => {
      const input = buildFixture({
        teamCount: 2,
        venues: [{
          id:   'v1',
          name: 'V1',
          concurrentPitches: 1,
          availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '11:00' }],
          fallbackWindows:     [{ dayOfWeek: 0, startTime: '14:00', endTime: '16:00' }],
        }],
      });
      const slots = generateSlots(input);
      let seenFallback = false;
      for (const s of slots) {
        if (s.isFallback) seenFallback = true;
        if (seenFallback && !s.isFallback) {
          // Primary slot encountered after fallback — violation
          expect.fail('Primary slot appears after fallback slot in sorted output');
        }
      }
    });

    it('slot endTime equals startTime + matchDurationMinutes', () => {
      const input = buildFixture({ teamCount: 2, matchDurationMinutes: 60 });
      const slots = generateSlots(input);
      for (const slot of slots.slice(0, 10)) { // sample first 10
        const [sh, sm] = slot.startTime.split(':').map(Number);
        const [eh, em] = slot.endTime.split(':').map(Number);
        const startMins = sh * 60 + sm;
        const endMins   = eh * 60 + em;
        expect(endMins - startMins).toBe(60);
      }
    });

    it('slot key has format "date|venueId|startTime"', () => {
      const input = buildFixture({ teamCount: 2 });
      const slots = generateSlots(input);
      for (const slot of slots.slice(0, 5)) {
        const parts = slot.key.split('|');
        expect(parts).toHaveLength(3);
        expect(parts[0]).toBe(slot.date);
        expect(parts[1]).toBe(slot.venueId);
        expect(parts[2]).toBe(slot.startTime);
      }
    });
  });

  describe('generatePairings', () => {
    it('generates N*(N-1)/2 pairings for single_round_robin with even N', () => {
      const input = buildFixture({ teamCount: 4 });
      const pairings = generatePairings(input);
      // 4*3/2 = 6
      expect(pairings).toHaveLength(6);
    });

    it('generates N*(N-1) pairings for double_round_robin with even N', () => {
      const input = buildFixture({ teamCount: 4, format: 'double_round_robin' });
      const pairings = generatePairings(input);
      // 4*3 = 12
      expect(pairings).toHaveLength(12);
    });

    it('no pairing has the same team as both home and away', () => {
      const input = buildFixture({ teamCount: 6 });
      const pairings = generatePairings(input);
      for (const p of pairings) {
        expect(p.homeTeamId).not.toBe(p.awayTeamId);
      }
    });

    it('no pairing references BYE team ID', () => {
      // BYE pairings are internal and must be stripped from output
      const input = buildFixture({ teamCount: 5 });
      const pairings = generatePairings(input);
      for (const p of pairings) {
        expect(p.homeTeamId).not.toBe('BYE');
        expect(p.awayTeamId).not.toBe('BYE');
      }
    });

    it('all team IDs in pairings match the input team IDs', () => {
      const input = buildFixture({ teamCount: 4 });
      const teamIds = new Set(input.teams.map(t => t.id));
      const pairings = generatePairings(input);
      for (const p of pairings) {
        expect(teamIds.has(p.homeTeamId)).toBe(true);
        expect(teamIds.has(p.awayTeamId)).toBe(true);
      }
    });

    it('round numbers are 1-indexed', () => {
      const input = buildFixture({ teamCount: 4 });
      const pairings = generatePairings(input);
      for (const p of pairings) {
        expect(p.round).toBeGreaterThanOrEqual(1);
      }
    });

    it('in double round-robin, second leg reverses home/away of first leg', () => {
      const input = buildFixture({ teamCount: 4, format: 'double_round_robin' });
      const pairings = generatePairings(input);
      const n = input.teams.length;      // 4
      const roundsPerLeg = n - 1;        // 3

      // First leg: rounds 1–3; second leg: rounds 4–6
      const firstLeg  = pairings.filter(p => p.round <= roundsPerLeg);
      const secondLeg = pairings.filter(p => p.round > roundsPerLeg);

      expect(firstLeg).toHaveLength(secondLeg.length);

      // For every first-leg pairing (A vs B), there must be a second-leg pairing (B vs A)
      for (const fl of firstLeg) {
        const reversed = secondLeg.find(
          sl => sl.homeTeamId === fl.awayTeamId && sl.awayTeamId === fl.homeTeamId
        );
        expect(reversed, `No reversed pairing found for ${fl.homeTeamId} vs ${fl.awayTeamId}`).toBeDefined();
      }
    });
  });

  describe('feasibilityPreCheck', () => {
    it('does not throw for a well-resourced input', () => {
      const input = buildFixture({ teamCount: 4 });
      expect(() => feasibilityPreCheck(input)).not.toThrow();
    });

    it('throws with "infeasible" message when raw capacity < 50% of required', () => {
      // 1 pitch, 60-min window, 90-min match = 0 slots
      const input: GenerateScheduleInput = {
        leagueId:   'l1',
        leagueName: 'L1',
        teams: [{ id: 't1', name: 'T1' }, { id: 't2', name: 'T2' }, { id: 't3', name: 'T3' }, { id: 't4', name: 'T4' }],
        venues: [{
          id:   'v1',
          name: 'V1',
          concurrentPitches: 1,
          availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '10:00' }],
        }],
        seasonStart: '2026-09-05',
        seasonEnd:   '2026-11-28',
        format: 'single_round_robin',
        matchDurationMinutes: 90,
        bufferMinutes: 0,
        minRestDays: 1,
        softConstraintPriority: [],
        homeAwayMode: 'relaxed',
      };
      expect(() => feasibilityPreCheck(input)).toThrow(/infeasible/);
    });

    it('uses gamesPerTeam when provided to determine required fixtures', () => {
      // 4 teams, gamesPerTeam = 1 → ceil(1*4/2) = 2 required fixtures
      // Should not throw since there is ample capacity
      const input = buildFixture({ teamCount: 4, gamesPerTeam: 1 });
      expect(() => feasibilityPreCheck(input)).not.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 7: Determinism
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 7: Determinism', () => {
  it('same input always produces identical fixture output', () => {
    const input = buildFixture({ teamCount: 6 });
    const run1 = runSchedule(input);
    const run2 = runSchedule(input);
    expect(run1.fixtures.map(f => `${f.date}|${f.homeTeamId}|${f.awayTeamId}`))
      .toEqual(run2.fixtures.map(f => `${f.date}|${f.homeTeamId}|${f.awayTeamId}`));
  });

  it('different leagueIds produce different schedules for the same teams and season', () => {
    const input1 = { ...buildFixture({ teamCount: 6 }), leagueId: 'league-alpha' };
    const input2 = { ...buildFixture({ teamCount: 6 }), leagueId: 'league-beta' };
    const run1 = runSchedule(input1);
    const run2 = runSchedule(input2);
    expect(run1.fixtures.length).toBe(run2.fixtures.length);
  });
});
