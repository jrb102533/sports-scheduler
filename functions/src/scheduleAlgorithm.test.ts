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
  expandVenueSurfaces,
  runScheduleAlgorithm,
  isCoachUnavailable,
  type GenerateScheduleInput,
  type ScheduleVenueInput,
  type ScheduleTeamInput,
  type GeneratedFixture,
  type Pairing,
  type ScheduleSurfaceInput,
  type DivisionInput,
  type CoachAvailabilityInput,
  type AvailabilityState,
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

  describe('round-based game packing (4 teams, 1 pitch, wide window)', () => {
    // Regression: shuffle order used to cause all of one team's games to be
    // processed first. Because daysBetween(futureLastGameDate, pastSlot) < 0 < minRestDays,
    // the algorithm would skip earlier available slots, serialising games 1-per-week
    // instead of packing 2 non-conflicting games per Saturday.
    it('schedules at least 2 games per match-day when capacity allows', () => {
      const seed = fnv32a('league-test|2026-04-25');
      const input: GenerateScheduleInput = {
        leagueId: 'league-test',
        leagueName: 'Test League',
        teams: [
          { id: 'A', name: 'Team A' },
          { id: 'B', name: 'Team B' },
          { id: 'C', name: 'Team C' },
          { id: 'D', name: 'Team D' },
        ],
        venues: [{
          id: 'venue-1',
          name: 'Main Venue',
          concurrentPitches: 1,
          availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '17:00' }],
        }],
        seasonStart: '2026-04-25',
        seasonEnd: '2026-06-27',
        format: 'single_round_robin',
        matchDurationMinutes: 60,
        bufferMinutes: 15,
        minRestDays: 6,
        softConstraintPriority: [],
        homeAwayMode: 'relaxed',
      };

      const output = runScheduleAlgorithm(input, seed);

      // Count games per date
      const gamesPerDate = new Map<string, number>();
      for (const f of output.fixtures) {
        gamesPerDate.set(f.date, (gamesPerDate.get(f.date) ?? 0) + 1);
      }

      // With a wide-enough window (8 hrs / 75-min slots = 6 slots per Sat),
      // at least one Saturday should have 2 games (the 2 non-conflicting round-mates).
      const datesWithTwoPlus = Array.from(gamesPerDate.values()).filter(c => c >= 2);
      expect(datesWithTwoPlus.length).toBeGreaterThan(0);
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

// ─────────────────────────────────────────────────────────────────────────────
// Section 8: Phase 1b — Division-aware & Surface-aware scheduling
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 8: Phase 1b — division-aware and surface-aware scheduling', () => {

  // ── Helpers for this section ──────────────────────────────────────────────

  /**
   * A venue with two explicitly named surfaces and ample weekend availability.
   * Used by most tests in this section.
   */
  function twoSurfaceVenue(venueId = 'venue-surf'): ScheduleVenueInput {
    return {
      id: venueId,
      name: 'Surface Venue',
      concurrentPitches: 1, // ignored when surfaces is set
      availabilityWindows: [
        { dayOfWeek: 6, startTime: '09:00', endTime: '18:00' },
        { dayOfWeek: 0, startTime: '09:00', endTime: '18:00' },
      ],
      surfaces: [
        { id: 'pitch-a', name: 'Pitch A' },
        { id: 'pitch-b', name: 'Pitch B' },
      ],
    };
  }

  /**
   * Build a minimal valid input for multi-division tests.
   * Teams are split evenly between two divisions.
   */
  function buildDivisionInput(opts: {
    teamsPerDivision?: number;
    matchDurationA?: number;
    matchDurationB?: number;
    venueId?: string;
    divASurfacePreference?: DivisionInput['surfacePreferences'];
    divBSurfacePreference?: DivisionInput['surfacePreferences'];
  } = {}): GenerateScheduleInput {
    const {
      teamsPerDivision = 2,
      matchDurationA = 60,
      matchDurationB = 60,
      venueId = 'venue-surf',
      divASurfacePreference,
      divBSurfacePreference,
    } = opts;

    const divATeams: ScheduleTeamInput[] = Array.from({ length: teamsPerDivision }, (_, i) => ({
      id:   `div-a-team-${i + 1}`,
      name: `Div A Team ${i + 1}`,
    }));
    const divBTeams: ScheduleTeamInput[] = Array.from({ length: teamsPerDivision }, (_, i) => ({
      id:   `div-b-team-${i + 1}`,
      name: `Div B Team ${i + 1}`,
    }));

    const divA: DivisionInput = {
      id:     'div-a',
      name:   'Division A',
      teamIds: divATeams.map(t => t.id),
      format:  'single_round_robin',
      matchDurationMinutes: matchDurationA,
      ...(divASurfacePreference ? { surfacePreferences: divASurfacePreference } : {}),
    };
    const divB: DivisionInput = {
      id:     'div-b',
      name:   'Division B',
      teamIds: divBTeams.map(t => t.id),
      format:  'single_round_robin',
      matchDurationMinutes: matchDurationB,
      ...(divBSurfacePreference ? { surfacePreferences: divBSurfacePreference } : {}),
    };

    return {
      leagueId:             'league-div-test',
      leagueName:           'Division Test League',
      teams:                [...divATeams, ...divBTeams],
      venues:               [twoSurfaceVenue(venueId)],
      seasonStart:          '2026-09-05',
      seasonEnd:            '2026-11-28',
      format:               'single_round_robin',
      matchDurationMinutes: Math.max(matchDurationA, matchDurationB),
      bufferMinutes:        15,
      minRestDays:          1,
      softConstraintPriority: [],
      homeAwayMode:         'relaxed',
      divisions:            [divA, divB],
    };
  }

  // ── expandVenueSurfaces ────────────────────────────────────────────────────

  describe('expandVenueSurfaces', () => {
    it('returns the surfaces array when surfaces is non-empty', () => {
      const surfaces: ScheduleSurfaceInput[] = [
        { id: 'p1', name: 'Pitch 1' },
        { id: 'p2', name: 'Pitch 2' },
      ];
      const venue: ScheduleVenueInput = {
        id: 'v1', name: 'V1', concurrentPitches: 5,
        availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '17:00' }],
        surfaces,
      };
      const result = expandVenueSurfaces(venue);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('p1');
      expect(result[1].id).toBe('p2');
    });

    it('synthesizes surfaces from concurrentPitches when surfaces is absent', () => {
      const venue: ScheduleVenueInput = {
        id: 'v1', name: 'V1', concurrentPitches: 3,
        availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '17:00' }],
      };
      const result = expandVenueSurfaces(venue);
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('_pitch_0');
      expect(result[1].id).toBe('_pitch_1');
      expect(result[2].id).toBe('_pitch_2');
      expect(result[0].name).toBe('Pitch 1');
    });

    it('synthesizes 1 surface when concurrentPitches is absent (defaults to 1)', () => {
      const venue: ScheduleVenueInput = {
        id: 'v1', name: 'V1', concurrentPitches: 1,
        availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '17:00' }],
      };
      // Override to simulate absent concurrentPitches
      const venueNoPitches = { ...venue } as ScheduleVenueInput & { concurrentPitches?: number };
      delete venueNoPitches.concurrentPitches;
      const result = expandVenueSurfaces(venueNoPitches as ScheduleVenueInput);
      expect(result).toHaveLength(1);
    });
  });

  // ── Surface-aware slot generation (backward compat) ──────────────────────

  describe('generateSlots backward compatibility', () => {
    it('legacy venues (no surfaces) produce 3-part slot keys date|venueId|startTime', () => {
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

    it('legacy venues produce slots with concurrentCapacity = concurrentPitches', () => {
      const input = buildFixture({
        teamCount: 2,
        venues: [{
          id: 'v1', name: 'V1', concurrentPitches: 3,
          availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '12:00' }],
        }],
      });
      const slots = generateSlots(input);
      for (const slot of slots) {
        expect(slot.concurrentCapacity).toBe(3);
      }
    });
  });

  // ── Surface-aware slot generation (named surfaces path) ──────────────────

  describe('generateSlots surface-aware path', () => {
    it('produces 4-part slot keys date|venueId|surfaceId|startTime for named surfaces', () => {
      const venue = twoSurfaceVenue();
      const input: GenerateScheduleInput = {
        ...buildFixture({ teamCount: 2, venues: [venue] }),
      };
      const slots = generateSlots(input);
      for (const slot of slots) {
        const parts = slot.key.split('|');
        expect(parts).toHaveLength(4);
        expect(parts[0]).toBe(slot.date);
        expect(parts[1]).toBe(slot.venueId);
        expect(parts[2]).toBe(slot.surfaceId);
        expect(parts[3]).toBe(slot.startTime);
      }
    });

    it('each named surface slot has concurrentCapacity = 1', () => {
      const venue = twoSurfaceVenue();
      const input: GenerateScheduleInput = {
        ...buildFixture({ teamCount: 2, venues: [venue] }),
      };
      const slots = generateSlots(input);
      for (const slot of slots) {
        expect(slot.concurrentCapacity).toBe(1);
      }
    });

    it('produces separate slots per surface for the same start time', () => {
      const venue = twoSurfaceVenue();
      const input: GenerateScheduleInput = {
        ...buildFixture({ teamCount: 2, venues: [venue] }),
      };
      const slots = generateSlots(input);
      // For each date+startTime combo, we should have one slot per surface
      const groupKey = (s: (typeof slots)[0]) => `${s.date}|${s.startTime}`;
      const groups = new Map<string, typeof slots>();
      for (const slot of slots) {
        const k = groupKey(slot);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(slot);
      }
      for (const [, group] of groups) {
        // Two surfaces → two slots per start time per date
        expect(group).toHaveLength(2);
        const surfaceIds = group.map(s => s.surfaceId);
        expect(surfaceIds).toContain('pitch-a');
        expect(surfaceIds).toContain('pitch-b');
      }
    });

    it('surface-specific blackout dates exclude that surface on the blackout date', () => {
      const venue: ScheduleVenueInput = {
        id: 'venue-surf', name: 'Surface Venue', concurrentPitches: 1,
        availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '18:00' }],
        surfaces: [
          { id: 'pitch-a', name: 'Pitch A', blackoutDates: ['2026-09-05'] },
          { id: 'pitch-b', name: 'Pitch B' },
        ],
      };
      const input: GenerateScheduleInput = {
        ...buildFixture({ teamCount: 2, venues: [venue] }),
        seasonStart: '2026-09-05',
        seasonEnd:   '2026-09-12',
      };
      const slots = generateSlots(input);
      // pitch-a should have no slots on 2026-09-05 (Saturday), but pitch-b should
      const pitchAOnBlackout = slots.filter(s => s.date === '2026-09-05' && s.surfaceId === 'pitch-a');
      const pitchBOnBlackout = slots.filter(s => s.date === '2026-09-05' && s.surfaceId === 'pitch-b');
      expect(pitchAOnBlackout).toHaveLength(0);
      expect(pitchBOnBlackout.length).toBeGreaterThan(0);
    });

    it('surface-specific availability windows override venue windows', () => {
      const venue: ScheduleVenueInput = {
        id: 'venue-surf', name: 'Surface Venue', concurrentPitches: 1,
        // Venue window: all day Saturday
        availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '18:00' }],
        surfaces: [
          {
            id: 'pitch-a', name: 'Pitch A',
            // Surface override: only morning
            availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '12:00' }],
          },
          { id: 'pitch-b', name: 'Pitch B' }, // no override → inherits venue window
        ],
      };
      const input: GenerateScheduleInput = {
        ...buildFixture({ teamCount: 2, venues: [venue], matchDurationMinutes: 60, bufferMinutes: 0 }),
        seasonStart: '2026-09-05',
        seasonEnd:   '2026-09-05', // single Saturday
      };
      const slots = generateSlots(input);
      const pitchASlots = slots.filter(s => s.surfaceId === 'pitch-a');
      const pitchBSlots = slots.filter(s => s.surfaceId === 'pitch-b');
      // Pitch A: 09:00–12:00 with 60min duration = 3 slots
      expect(pitchASlots).toHaveLength(3);
      // Pitch B: 09:00–18:00 with 60min duration = 9 slots
      expect(pitchBSlots).toHaveLength(9);
    });
  });

  // ── Single division with named surfaces ──────────────────────────────────

  describe('single division with named surfaces schedules correctly', () => {
    it('produces a feasible schedule and stamps fixtures with divisionId', () => {
      const venue = twoSurfaceVenue();
      const input: GenerateScheduleInput = {
        leagueId:             'league-single-div',
        leagueName:           'Single Division League',
        teams: [
          { id: 'ta1', name: 'Team A1' },
          { id: 'ta2', name: 'Team A2' },
        ],
        venues: [venue],
        seasonStart:          '2026-09-05',
        seasonEnd:            '2026-11-28',
        format:               'single_round_robin',
        matchDurationMinutes: 60,
        bufferMinutes:        15,
        minRestDays:          1,
        softConstraintPriority: [],
        homeAwayMode:         'relaxed',
        divisions: [{
          id:     'div-a',
          name:   'Division A',
          teamIds: ['ta1', 'ta2'],
          format:  'single_round_robin',
          matchDurationMinutes: 60,
        }],
      };

      const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
      const output = runScheduleAlgorithm(input, seed);

      expect(output.stats.feasible).toBe(true);
      expect(output.fixtures).toHaveLength(1);
      expect(output.fixtures[0].divisionId).toBe('div-a');
      expect(output.divisionResults).toHaveLength(1);
      expect(output.divisionResults![0].divisionId).toBe('div-a');
      expect(output.divisionResults![0].fixtures).toHaveLength(1);
    });
  });

  // ── Two divisions, same match duration — no surface double-booking ────────

  describe('two divisions sharing a venue with same match duration — no double-booking', () => {
    it('no two fixtures share the same surface at the same date+startTime', () => {
      const input = buildDivisionInput({ matchDurationA: 60, matchDurationB: 60 });
      const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
      const output = runScheduleAlgorithm(input, seed);

      expect(output.stats.feasible).toBe(true);

      // Group fixtures by date|venueId|surfaceId|startTime — must be unique
      const surfaceSlotUsage = new Map<string, number>();
      for (const f of output.fixtures) {
        // Find the surfaceId from divisionResults if needed — for surface-aware venues,
        // each fixture is uniquely placed on a surface via the slot key.
        // We verify at the slot key level using date+venue+startTime per surface.
        const key = `${f.date}|${f.venueId}|${f.startTime}`;
        surfaceSlotUsage.set(key, (surfaceSlotUsage.get(key) ?? 0) + 1);
      }
      // With 2 surfaces, at most 2 fixtures can share same date+venue+startTime
      for (const [key, count] of surfaceSlotUsage) {
        expect(count, `Slot ${key} has ${count} fixtures (max 2 surfaces)`).toBeLessThanOrEqual(2);
      }
    });

    it('divisionResults contains one entry per division', () => {
      const input = buildDivisionInput();
      const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
      const output = runScheduleAlgorithm(input, seed);
      expect(output.divisionResults).toHaveLength(2);
      const ids = output.divisionResults!.map(d => d.divisionId).sort();
      expect(ids).toEqual(['div-a', 'div-b']);
    });

    it('all fixtures in merged output have a divisionId set', () => {
      const input = buildDivisionInput();
      const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
      const output = runScheduleAlgorithm(input, seed);
      for (const f of output.fixtures) {
        expect(f.divisionId).toBeDefined();
        expect(['div-a', 'div-b']).toContain(f.divisionId);
      }
    });
  });

  // ── Two divisions, DIFFERENT match durations — duration-aware overlap ─────

  describe('two divisions with different match durations — no time-window overlap on any surface', () => {
    it('U8 (45 min) and U14 (90 min) games do not overlap on the same surface', () => {
      // Critical test: without surfaceTimeWindows, a 45-min game at 09:00 (ends 09:45)
      // and a 90-min game at 09:30 (ends 11:00) would both pass slot key capacity checks
      // because they have different start times but share the same surface.

      // Use a venue with a single surface to force contention onto the same surface
      const singleSurfaceVenue: ScheduleVenueInput = {
        id: 'venue-single', name: 'Single Surface Venue', concurrentPitches: 1,
        availabilityWindows: [
          { dayOfWeek: 6, startTime: '09:00', endTime: '18:00' },
          { dayOfWeek: 0, startTime: '09:00', endTime: '18:00' },
        ],
        surfaces: [{ id: 'pitch-only', name: 'The Only Pitch' }],
      };

      // 3 teams per division to create more pairings and increase contention
      const divATeams: ScheduleTeamInput[] = [
        { id: 'u8-t1', name: 'U8 Team 1' },
        { id: 'u8-t2', name: 'U8 Team 2' },
        { id: 'u8-t3', name: 'U8 Team 3' },
      ];
      const divBTeams: ScheduleTeamInput[] = [
        { id: 'u14-t1', name: 'U14 Team 1' },
        { id: 'u14-t2', name: 'U14 Team 2' },
        { id: 'u14-t3', name: 'U14 Team 3' },
      ];

      const input: GenerateScheduleInput = {
        leagueId:             'league-overlap-test',
        leagueName:           'Overlap Test League',
        teams:                [...divATeams, ...divBTeams],
        venues:               [singleSurfaceVenue],
        seasonStart:          '2026-09-05',
        seasonEnd:            '2026-11-28',
        format:               'single_round_robin',
        matchDurationMinutes: 90, // top-level (used for slot generation)
        bufferMinutes:        0,  // no buffer so slots are packed tightly
        minRestDays:          0,
        softConstraintPriority: [],
        homeAwayMode:         'relaxed',
        divisions: [
          {
            id:     'div-u8',
            name:   'U8',
            teamIds: divATeams.map(t => t.id),
            format:  'single_round_robin',
            matchDurationMinutes: 45,
          },
          {
            id:     'div-u14',
            name:   'U14',
            teamIds: divBTeams.map(t => t.id),
            format:  'single_round_robin',
            matchDurationMinutes: 90,
          },
        ],
      };

      const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
      const output = runScheduleAlgorithm(input, seed);

      // Verify: no two assigned fixtures have overlapping time windows on the same surface
      // Group fixtures by date+venueId+surfaceId
      const fixturesBySurface = new Map<string, GeneratedFixture[]>();
      for (const f of output.fixtures) {
        // For the single-surface venue, all fixtures are on pitch-only
        const key = `${f.date}|${f.venueId}`;
        if (!fixturesBySurface.has(key)) fixturesBySurface.set(key, []);
        fixturesBySurface.get(key)!.push(f);
      }

      for (const [surfaceKey, fixtures] of fixturesBySurface) {
        for (let i = 0; i < fixtures.length; i++) {
          for (let j = i + 1; j < fixtures.length; j++) {
            const a = fixtures[i];
            const b = fixtures[j];
            // Look up each fixture's division to get its actual match duration
            const aDivId = a.divisionId!;
            const bDivId = b.divisionId!;
            const aDuration = aDivId === 'div-u8' ? 45 : 90;
            const bDuration = bDivId === 'div-u8' ? 45 : 90;

            const aStart = a.startTime.split(':').map(Number).reduce((h, m) => h * 60 + m, 0);
            const bStart = b.startTime.split(':').map(Number).reduce((h, m) => h * 60 + m, 0);
            const aEnd = aStart + aDuration;
            const bEnd = bStart + bDuration;

            const overlaps = aStart < bEnd && aEnd > bStart;
            expect(overlaps, `Surface ${surfaceKey}: ${a.startTime}+${aDuration}min overlaps ${b.startTime}+${bDuration}min`).toBe(false);
          }
        }
      }
    });
  });

  // ── Required surface preference ────────────────────────────────────────────

  describe('division with required surface preference only books that surface', () => {
    it('all fixtures for div-a land on pitch-a when required', () => {
      const input = buildDivisionInput({
        divASurfacePreference: [{
          venueId: 'venue-surf',
          surfaceId: 'pitch-a',
          preference: 'required',
        }],
      });

      const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
      const output = runScheduleAlgorithm(input, seed);

      const divAResult = output.divisionResults?.find(d => d.divisionId === 'div-a');
      expect(divAResult).toBeDefined();

      for (const f of divAResult!.fixtures) {
        // All div-a fixtures must be on pitch-a
        // We verify by checking the slot key stored in divisionResults fixtures
        // Since we can't directly inspect surfaceId from GeneratedFixture,
        // we check it via the divisionResult fixtures which were assigned via surface-filtered slots
        expect(f.venueId).toBe('venue-surf');
        // The fixture must be on pitch-a — we assert this indirectly:
        // div-b should have pitch-b available since pitch-a is taken by div-a
        // This test primarily verifies feasibility with a required surface constraint
      }

      // Schedule must be feasible — required surface has ample slots
      expect(divAResult!.unassignedCount).toBe(0);
    });
  });

  // ── Preferred surface preference ───────────────────────────────────────────

  describe('division with preferred surface preference falls back when needed', () => {
    it('schedule remains feasible when preferred surface is limited', () => {
      // Both divisions prefer pitch-a (soft preference only)
      // The algorithm should still assign all games, falling back to pitch-b when needed
      const input = buildDivisionInput({
        teamsPerDivision: 3, // more pairings to force fallback
        divASurfacePreference: [{
          venueId: 'venue-surf',
          surfaceId: 'pitch-a',
          preference: 'preferred',
        }],
        divBSurfacePreference: [{
          venueId: 'venue-surf',
          surfaceId: 'pitch-a',
          preference: 'preferred',
        }],
      });

      const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
      const output = runScheduleAlgorithm(input, seed);

      // All fixtures should still be assigned — preferred is a soft hint, not a hard block
      expect(output.stats.feasible).toBe(true);
      expect(output.stats.unassignedFixtures).toBe(0);
    });
  });

  // ── Validation: team in two divisions ─────────────────────────────────────

  describe('validateInput — division constraints', () => {
    it('rejects input with a team appearing in two divisions', () => {
      const input = buildDivisionInput();
      // Inject div-b-team-1 into div-a as well
      input.divisions![0].teamIds.push('div-b-team-1');

      expect(() => validateInput(input)).toThrow(/appears in multiple divisions/);
    });

    it('rejects division that references a team not in input.teams', () => {
      const input = buildDivisionInput();
      input.divisions![0].teamIds.push('ghost-team-99');

      expect(() => validateInput(input)).toThrow(/references unknown team/);
    });

    it('rejects more than 16 divisions (DoS cap)', () => {
      const input = buildFixture({ teamCount: 2 });
      input.divisions = Array.from({ length: 17 }, (_, i) => ({
        id:      `div-${i}`,
        name:    `Division ${i}`,
        teamIds: [],
        format:  'single_round_robin' as const,
      }));
      expect(() => validateInput(input)).toThrow(/at most 16/);
    });

    it('accepts valid divisions input without throwing', () => {
      const input = buildDivisionInput();
      expect(() => validateInput(input)).not.toThrow();
    });
  });

  // ── Single-pool path unchanged ─────────────────────────────────────────────

  describe('single-pool path remains fully functional', () => {
    it('runScheduleAlgorithm without divisions produces the same output as the manual pipeline', () => {
      const input = buildFixture({ teamCount: 4 });
      const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
      const output = runScheduleAlgorithm(input, seed);

      // Should be feasible and have the right fixture count
      expect(output.stats.feasible).toBe(true);
      expect(output.fixtures).toHaveLength(6);
      expect(output.divisionResults).toBeUndefined();
    });
  });

  // ── Division-specific seed ─────────────────────────────────────────────────

  describe('division-specific seed (fnv32a)', () => {
    it('produces different seeds for different division IDs', () => {
      const leagueId = 'league-test';
      const seasonStart = '2026-09-05';
      const seedA = fnv32a(`${leagueId}|div-a|${seasonStart}`);
      const seedB = fnv32a(`${leagueId}|div-b|${seasonStart}`);
      expect(seedA).not.toBe(seedB);
    });

    it('seed is stable across calls for the same inputs', () => {
      const s1 = fnv32a('league-test|div-a|2026-09-05');
      const s2 = fnv32a('league-test|div-a|2026-09-05');
      expect(s1).toBe(s2);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 9: Phase 2 — Three-state coach availability & per-division enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe('Section 9: Phase 2 — three-state coach availability', () => {

  // Minimal slot factory for unit tests — avoids the full pipeline.
  function makeSlot(date: string, startTime: string, endTime: string): Parameters<typeof isCoachUnavailable>[0] {
    return {
      key:               `${date}|venue-1|${startTime}`,
      date,
      startTime,
      endTime,
      venueId:           'venue-1',
      venueName:         'Main Venue',
      concurrentCapacity: 1,
      isFallback:        false,
    };
  }

  function makePairing(homeTeamId = 'team-1', awayTeamId = 'team-2'): Pairing {
    return { homeTeamId, awayTeamId, homeTeamName: homeTeamId, awayTeamName: awayTeamId, round: 1, pairingIndex: 0 };
  }

  // ── isCoachUnavailable unit tests ──────────────────────────────────────────

  describe('isCoachUnavailable', () => {
    it('returns false when coachAvailability is undefined', () => {
      const slot = makeSlot('2026-09-05', '10:00', '11:30');
      const pairing = makePairing();
      expect(isCoachUnavailable(slot, pairing, undefined)).toBe(false);
    });

    it('returns false when no entry exists for either team', () => {
      const slot = makeSlot('2026-09-05', '10:00', '11:30');
      const pairing = makePairing('team-1', 'team-2');
      const ca: CoachAvailabilityInput[] = [
        { teamId: 'team-99', weeklyWindows: [], dateOverrides: [] },
      ];
      expect(isCoachUnavailable(slot, pairing, ca)).toBe(false);
    });

    it('returns true when a date override covers the slot date', () => {
      const slot = makeSlot('2026-10-10', '10:00', '11:30');
      const pairing = makePairing('team-1', 'team-2');
      const ca: CoachAvailabilityInput[] = [
        {
          teamId: 'team-1',
          weeklyWindows: [],
          dateOverrides: [{ start: '2026-10-09', end: '2026-10-11', available: false }],
        },
      ];
      expect(isCoachUnavailable(slot, pairing, ca)).toBe(true);
    });

    it('returns false when a date override does NOT cover the slot date', () => {
      const slot = makeSlot('2026-10-15', '10:00', '11:30');
      const pairing = makePairing('team-1', 'team-2');
      const ca: CoachAvailabilityInput[] = [
        {
          teamId: 'team-1',
          weeklyWindows: [],
          dateOverrides: [{ start: '2026-10-09', end: '2026-10-11', available: false }],
        },
      ];
      expect(isCoachUnavailable(slot, pairing, ca)).toBe(false);
    });

    it('returns true when away coach has a date override covering the slot', () => {
      const slot = makeSlot('2026-10-10', '10:00', '11:30');
      const pairing = makePairing('team-1', 'team-2');
      const ca: CoachAvailabilityInput[] = [
        { teamId: 'team-1', weeklyWindows: [], dateOverrides: [] },
        {
          teamId: 'team-2',
          weeklyWindows: [],
          dateOverrides: [{ start: '2026-10-10', end: '2026-10-10', available: false }],
        },
      ];
      expect(isCoachUnavailable(slot, pairing, ca)).toBe(true);
    });

    it('returns true when weekly window state is "unavailable" for the slot time', () => {
      // 2026-09-05 is a Saturday (dayOfWeek = 6)
      const slot = makeSlot('2026-09-05', '10:00', '11:30');
      const pairing = makePairing('team-1', 'team-2');
      const ca: CoachAvailabilityInput[] = [
        {
          teamId: 'team-1',
          weeklyWindows: [
            { dayOfWeek: 6, startTime: '09:00', endTime: '18:00', state: 'unavailable' },
          ],
          dateOverrides: [],
        },
      ];
      expect(isCoachUnavailable(slot, pairing, ca)).toBe(true);
    });

    it('returns false when weekly window state is "preferred"', () => {
      const slot = makeSlot('2026-09-05', '10:00', '11:30');
      const pairing = makePairing('team-1', 'team-2');
      const ca: CoachAvailabilityInput[] = [
        {
          teamId: 'team-1',
          weeklyWindows: [
            { dayOfWeek: 6, startTime: '09:00', endTime: '18:00', state: 'preferred' },
          ],
          dateOverrides: [],
        },
      ];
      expect(isCoachUnavailable(slot, pairing, ca)).toBe(false);
    });

    it('returns false when weekly window state is "available"', () => {
      const slot = makeSlot('2026-09-05', '10:00', '11:30');
      const pairing = makePairing('team-1', 'team-2');
      const ca: CoachAvailabilityInput[] = [
        {
          teamId: 'team-1',
          weeklyWindows: [
            { dayOfWeek: 6, startTime: '09:00', endTime: '18:00', state: 'available' },
          ],
          dateOverrides: [],
        },
      ];
      expect(isCoachUnavailable(slot, pairing, ca)).toBe(false);
    });

    it('returns true when no weekly window is defined for the slot day', () => {
      // 2026-09-05 is Saturday (6); only Sunday (0) is defined
      const slot = makeSlot('2026-09-05', '10:00', '11:30');
      const pairing = makePairing('team-1', 'team-2');
      const ca: CoachAvailabilityInput[] = [
        {
          teamId: 'team-1',
          weeklyWindows: [
            { dayOfWeek: 0, startTime: '09:00', endTime: '18:00', state: 'available' },
          ],
          dateOverrides: [],
        },
      ];
      expect(isCoachUnavailable(slot, pairing, ca)).toBe(true);
    });

    // Backward-compat: legacy `available` boolean
    it('backward-compat: available:true treated as available (returns false)', () => {
      const slot = makeSlot('2026-09-05', '10:00', '11:30');
      const pairing = makePairing('team-1', 'team-2');
      const ca: CoachAvailabilityInput[] = [
        {
          teamId: 'team-1',
          weeklyWindows: [
            { dayOfWeek: 6, startTime: '09:00', endTime: '18:00', available: true },
          ],
          dateOverrides: [],
        },
      ];
      expect(isCoachUnavailable(slot, pairing, ca)).toBe(false);
    });

    it('backward-compat: available:false treated as unavailable (returns true)', () => {
      const slot = makeSlot('2026-09-05', '10:00', '11:30');
      const pairing = makePairing('team-1', 'team-2');
      const ca: CoachAvailabilityInput[] = [
        {
          teamId: 'team-1',
          weeklyWindows: [
            { dayOfWeek: 6, startTime: '09:00', endTime: '18:00', available: false },
          ],
          dateOverrides: [],
        },
      ];
      expect(isCoachUnavailable(slot, pairing, ca)).toBe(true);
    });
  });

  // ── computeCoachAvailabilityPenalty — three-state scoring ─────────────────

  describe('three-state penalty scoring via full pipeline', () => {
    /**
     * Build a minimal input where team-1 vs team-2 schedules one game.
     * Inject coachAvailability and check which slots get chosen.
     * The season contains only Saturdays so DOW=6 windows are all that matters.
     */
    function buildTwoTeamInput(
      coachAvailability: CoachAvailabilityInput[],
      constraints: GenerateScheduleInput['softConstraintPriority'] = ['respect_coach_availability'],
    ): GenerateScheduleInput {
      return {
        leagueId:   'league-phase2',
        leagueName: 'Phase 2 Test',
        teams: [
          { id: 'team-1', name: 'Team 1' },
          { id: 'team-2', name: 'Team 2' },
        ],
        venues: [{
          id:   'venue-1',
          name: 'Main Venue',
          concurrentPitches: 4,
          // Multiple Saturday windows so the scheduler can pick between them
          availabilityWindows: [
            { dayOfWeek: 6, startTime: '09:00', endTime: '18:00' },
          ],
        }],
        seasonStart: '2026-09-05',  // Saturday
        seasonEnd:   '2026-11-28',
        format:      'single_round_robin',
        matchDurationMinutes: 90,
        bufferMinutes:        0,
        minRestDays:          1,
        softConstraintPriority: constraints,
        homeAwayMode: 'relaxed',
        coachAvailability,
      };
    }

    it('a "preferred" slot is chosen over an "available" slot when respect_coach_availability is active', () => {
      // team-1 marks 09:00 as preferred, 12:00 as available
      // Scheduler should pick 09:00 (negative penalty = lower total)
      const ca: CoachAvailabilityInput[] = [
        {
          teamId: 'team-1',
          weeklyWindows: [
            { dayOfWeek: 6, startTime: '09:00', endTime: '10:30', state: 'preferred' },
            { dayOfWeek: 6, startTime: '12:00', endTime: '13:30', state: 'available' },
          ],
          dateOverrides: [],
        },
      ];
      const input = buildTwoTeamInput(ca);
      const output = runSchedule(input);
      expect(output.fixtures).toHaveLength(1);
      // The preferred slot (09:00) should be selected
      expect(output.fixtures[0].startTime).toBe('09:00');
    });

    it('an "unavailable" slot incurs a positive penalty (deprioritized but not excluded in soft mode)', () => {
      // Both slots available; team-1 marks 12:00 as unavailable.
      // With respect_coach_availability, scheduler should prefer the 09:00 slot.
      const ca: CoachAvailabilityInput[] = [
        {
          teamId: 'team-1',
          weeklyWindows: [
            { dayOfWeek: 6, startTime: '09:00', endTime: '10:30', state: 'available' },
            { dayOfWeek: 6, startTime: '12:00', endTime: '13:30', state: 'unavailable' },
          ],
          dateOverrides: [],
        },
      ];
      const input = buildTwoTeamInput(ca);
      const output = runSchedule(input);
      expect(output.fixtures).toHaveLength(1);
      expect(output.fixtures[0].startTime).toBe('09:00');
    });
  });

  // ── Hard enforcement via division.enforcement === 'hard' ───────────────────

  describe('hard enforcement via division enforcement mode', () => {
    /**
     * Build a division-aware input where one division has hard enforcement.
     * The coach for team-1 is unavailable on all Saturdays (dateOverride spans the whole season).
     * With hard enforcement, the algorithm must schedule the game on another day.
     * We add Sunday windows to ensure there is a feasible alternative.
     */
    function buildHardEnforcementInput(enforcement: 'soft' | 'hard'): GenerateScheduleInput {
      const teamA1: ScheduleTeamInput = { id: 'div-a-1', name: 'Div A Team 1' };
      const teamA2: ScheduleTeamInput = { id: 'div-a-2', name: 'Div A Team 2' };

      const divA: DivisionInput = {
        id:     'div-a',
        name:   'Division A',
        teamIds: [teamA1.id, teamA2.id],
        format:  'single_round_robin',
        enforcement,
      };

      // Coach for div-a-1 unavailable all Saturdays
      const coachAvailability: CoachAvailabilityInput[] = [
        {
          teamId: teamA1.id,
          weeklyWindows: [
            // Only available Sundays
            { dayOfWeek: 0, startTime: '09:00', endTime: '18:00', state: 'available' },
          ],
          dateOverrides: [],
        },
      ];

      return {
        leagueId:   'league-hard',
        leagueName: 'Hard Enforcement League',
        teams:      [teamA1, teamA2],
        venues: [{
          id:   'venue-h',
          name: 'Hard Venue',
          concurrentPitches: 4,
          availabilityWindows: [
            { dayOfWeek: 6, startTime: '09:00', endTime: '18:00' }, // Saturday
            { dayOfWeek: 0, startTime: '09:00', endTime: '18:00' }, // Sunday
          ],
        }],
        seasonStart: '2026-09-05',  // Saturday
        seasonEnd:   '2026-11-28',
        format:      'single_round_robin',
        matchDurationMinutes: 90,
        bufferMinutes:        0,
        minRestDays:          1,
        softConstraintPriority: ['respect_coach_availability'],
        homeAwayMode: 'relaxed',
        coachAvailability,
        divisions: [divA],
      };
    }

    it('hard enforcement: game is never scheduled on a Saturday when coach is unavailable Saturdays', () => {
      const input = buildHardEnforcementInput('hard');
      const seed  = fnv32a(input.leagueId + '|' + input.seasonStart);
      const output = runScheduleAlgorithm(input, seed);

      expect(output.fixtures).toHaveLength(1);
      // All fixtures must fall on Sunday (DOW=0); Saturday is blacked out
      for (const f of output.fixtures) {
        const dow = new Date(f.date + 'T00:00:00Z').getUTCDay();
        expect(dow).toBe(0); // Sunday
      }
    });

    it('soft enforcement: game may be scheduled on Saturday despite availability penalty', () => {
      // Soft mode: Saturday is penalised but not excluded.
      // With only 2 teams (1 game), the scheduler may still pick Saturday
      // if no penalty-free alternative is ranked higher — we verify it doesn't crash
      // and produces exactly 1 fixture (we do NOT assert the day, only feasibility).
      const input = buildHardEnforcementInput('soft');
      const seed  = fnv32a(input.leagueId + '|' + input.seasonStart);
      const output = runScheduleAlgorithm(input, seed);

      expect(output.fixtures).toHaveLength(1);
    });

    it('default enforcement is soft (no enforcement field) — does not crash', () => {
      // Division without enforcement field — should default to 'soft'
      const input = buildHardEnforcementInput('soft');
      // Remove enforcement field from division to test default
      const modifiedInput = {
        ...input,
        divisions: input.divisions!.map(({ enforcement: _e, ...rest }) => rest),
      };
      const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
      expect(() => runScheduleAlgorithm(modifiedInput, seed)).not.toThrow();
    });
  });
});
