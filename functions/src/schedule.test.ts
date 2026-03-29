/**
 * Unit tests for the deterministic schedule algorithm helper functions.
 * Covers spec §1, §3, §4 of docs/algorithm-spec-schedule.md v1.1
 */

import {
  validateInput,
  feasibilityPreCheck,
  generateSlots,
  generatePairings,
  shufflePairings,
  fnv32a,
  assignFixtures,
  buildOutput,
  daysBetween,
  scorePenalty,
  type GenerateScheduleInput,
  type Pairing,
} from './scheduleAlgorithm';

// ─── Fixtures / factories ─────────────────────────────────────────────────────

function makeTeam(id: string, name?: string, homeVenueId?: string) {
  return { id, name: name ?? id, ...(homeVenueId ? { homeVenueId } : {}) };
}

function makeVenue(id: string, name?: string) {
  return {
    id,
    name: name ?? id,
    concurrentPitches: 1,
    availabilityWindows: [
      { dayOfWeek: 6, startTime: '09:00', endTime: '17:00' }, // Saturday
      { dayOfWeek: 0, startTime: '10:00', endTime: '16:00' }, // Sunday
    ],
  };
}

function baseInput(overrides: Partial<GenerateScheduleInput> = {}): GenerateScheduleInput {
  return {
    leagueId: 'league-1',
    leagueName: 'Test League',
    teams: [makeTeam('t1', 'Alpha'), makeTeam('t2', 'Beta'), makeTeam('t3', 'Gamma'), makeTeam('t4', 'Delta')],
    venues: [makeVenue('v1', 'Stadium')],
    seasonStart: '2026-04-01',
    seasonEnd: '2026-06-30',
    format: 'single_round_robin',
    matchDurationMinutes: 60,
    bufferMinutes: 15,
    minRestDays: 1,
    softConstraintPriority: [],
    homeAwayMode: 'relaxed',
    ...overrides,
  };
}

// ─── generatePairings ─────────────────────────────────────────────────────────

describe('generatePairings', () => {
  it('single round-robin: 4 teams produces 6 fixtures', () => {
    const input = baseInput({ format: 'single_round_robin' });
    const pairings = generatePairings(input);
    expect(pairings).toHaveLength(6);
    // Every team should appear exactly 3 times (home or away)
    const teamCounts = new Map<string, number>();
    for (const p of pairings) {
      teamCounts.set(p.homeTeamId, (teamCounts.get(p.homeTeamId) ?? 0) + 1);
      teamCounts.set(p.awayTeamId, (teamCounts.get(p.awayTeamId) ?? 0) + 1);
    }
    for (const count of teamCounts.values()) {
      expect(count).toBe(3);
    }
  });

  it('double round-robin: 4 teams produces 12 fixtures', () => {
    const input = baseInput({ format: 'double_round_robin' });
    const pairings = generatePairings(input);
    expect(pairings).toHaveLength(12);
  });

  it('odd team count: 5 teams produces 10 fixtures (bye inserted)', () => {
    const input = baseInput({
      format: 'single_round_robin',
      teams: [
        makeTeam('t1'), makeTeam('t2'), makeTeam('t3'),
        makeTeam('t4'), makeTeam('t5'),
      ],
    });
    const pairings = generatePairings(input);
    // 5 teams → N=6 (bye added) → 15 pairs − 5 bye pairs = 10
    expect(pairings).toHaveLength(10);
    // BYE team should not appear in any pairing
    for (const p of pairings) {
      expect(p.homeTeamId).not.toBe('BYE');
      expect(p.awayTeamId).not.toBe('BYE');
    }
  });

  it('each pair of teams appears exactly once in single round-robin', () => {
    const input = baseInput({ format: 'single_round_robin' });
    const pairings = generatePairings(input);
    const pairSet = new Set<string>();
    for (const p of pairings) {
      const key = [p.homeTeamId, p.awayTeamId].sort().join('|');
      expect(pairSet.has(key)).toBe(false);
      pairSet.add(key);
    }
    expect(pairSet.size).toBe(6);
  });

  it('each pair of teams appears exactly twice in double round-robin (once each way)', () => {
    const input = baseInput({ format: 'double_round_robin' });
    const pairings = generatePairings(input);
    const pairMap = new Map<string, number>();
    for (const p of pairings) {
      const key = `${p.homeTeamId}|${p.awayTeamId}`;
      pairMap.set(key, (pairMap.get(key) ?? 0) + 1);
    }
    for (const count of pairMap.values()) {
      expect(count).toBe(1);
    }
    // Each unordered pair should have both a→b and b→a
    const teams = input.teams.map(t => t.id);
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        expect(pairMap.has(`${teams[i]}|${teams[j]}`)).toBe(true);
        expect(pairMap.has(`${teams[j]}|${teams[i]}`)).toBe(true);
      }
    }
  });

  it('gamesPerTeam partial round-robin truncates fixture count', () => {
    const input = baseInput({
      format: 'single_round_robin',
      gamesPerTeam: 2,
      // 4 teams, gamesPerTeam=2 → 4×2/2 = 4 fixtures
    });
    const pairings = generatePairings(input);
    expect(pairings).toHaveLength(4);
  });
});

// ─── generateSlots ────────────────────────────────────────────────────────────

describe('generateSlots', () => {
  it('respects venue blackout dates', () => {
    const input = baseInput({
      venues: [{
        id: 'v1',
        name: 'Stadium',
        concurrentPitches: 1,
        availabilityWindows: [
          { dayOfWeek: 6, startTime: '09:00', endTime: '12:00' },
        ],
        blackoutDates: ['2026-04-04'], // first Saturday in April
      }],
    });
    const slots = generateSlots(input);
    const blackedOut = slots.filter(s => s.date === '2026-04-04');
    expect(blackedOut).toHaveLength(0);
  });

  it('respects season blackout dates', () => {
    const input = baseInput({
      blackoutDates: ['2026-04-04'], // first Saturday
    });
    const slots = generateSlots(input);
    const blackedOut = slots.filter(s => s.date === '2026-04-04');
    expect(blackedOut).toHaveLength(0);
  });

  it('primary windows before fallback windows in slot order', () => {
    const input = baseInput({
      venues: [{
        id: 'v1',
        name: 'Stadium',
        concurrentPitches: 1,
        availabilityWindows: [
          { dayOfWeek: 6, startTime: '09:00', endTime: '12:00' },
        ],
        fallbackWindows: [
          { dayOfWeek: 1, startTime: '18:00', endTime: '21:00' }, // Monday
        ],
      }],
    });
    const slots = generateSlots(input);
    const primarySlots = slots.filter(s => !s.isFallback);
    const fallbackSlots = slots.filter(s => s.isFallback);
    // Primary slots should come before any fallback slot in the array
    if (primarySlots.length > 0 && fallbackSlots.length > 0) {
      const lastPrimaryIdx = slots.lastIndexOf(primarySlots[primarySlots.length - 1]);
      const firstFallbackIdx = slots.indexOf(fallbackSlots[0]);
      expect(lastPrimaryIdx).toBeLessThan(firstFallbackIdx);
    }
  });

  it('concurrentPitches: venue with 2 pitches generates slots with capacity 2', () => {
    const input = baseInput({
      venues: [{
        id: 'v1',
        name: 'Stadium',
        concurrentPitches: 2,
        availabilityWindows: [
          { dayOfWeek: 6, startTime: '09:00', endTime: '12:00' },
        ],
      }],
    });
    const slots = generateSlots(input);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(s.concurrentCapacity).toBe(2);
    }
  });

  it('generates no slots when all days are blacked out', () => {
    // Build a season with only Saturdays, all blacked out
    const input = baseInput({
      seasonStart: '2026-04-04', // Saturday
      seasonEnd: '2026-04-04',   // just one day
      blackoutDates: ['2026-04-04'],
    });
    const slots = generateSlots(input);
    expect(slots).toHaveLength(0);
  });

  it('generates correct number of slots per window', () => {
    // Window: 09:00–12:00, match=60min, buffer=15min → slot size=75min
    // 09:00–10:00, 10:15–11:15, 11:30-12:30 → but 11:30+60=12:30 > 12:00, so only 2 slots
    const input = baseInput({
      seasonStart: '2026-04-04',
      seasonEnd: '2026-04-04', // one Saturday
      venues: [{
        id: 'v1', name: 'S', concurrentPitches: 1,
        availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '12:00' }],
      }],
      matchDurationMinutes: 60,
      bufferMinutes: 15,
    });
    const slots = generateSlots(input);
    expect(slots).toHaveLength(2);
    expect(slots[0].startTime).toBe('09:00');
    expect(slots[1].startTime).toBe('10:15');
  });
});

// ─── feasibilityPreCheck ─────────────────────────────────────────────────────

describe('feasibilityPreCheck', () => {
  it('passes when slots > 50% of required', () => {
    const input = baseInput();
    // 4 teams single RR = 6 fixtures. Large season window with weekend slots = many slots
    expect(() => feasibilityPreCheck(input)).not.toThrow();
  });

  it('throws when slots < 50% of required with diagnostic message', () => {
    // Force infeasibility: 1-day season, 1 venue, only 1 slot available
    // but 4 teams single RR needs 6 fixtures → 50% threshold = 3 slots needed
    const input = baseInput({
      seasonStart: '2026-04-04',
      seasonEnd: '2026-04-04', // one Saturday
      venues: [{
        id: 'v1', name: 'S', concurrentPitches: 1,
        availabilityWindows: [{ dayOfWeek: 6, startTime: '09:00', endTime: '10:15' }], // only 1 slot
      }],
      matchDurationMinutes: 60,
      bufferMinutes: 15,
    });
    expect(() => feasibilityPreCheck(input)).toThrow(/infeasible/i);
  });
});

// ─── scorePenalty / soft constraints ─────────────────────────────────────────

describe('scorePenalty', () => {
  it('prefer_weekends: weekday slot scores higher than weekend slot', () => {
    const input = baseInput({
      softConstraintPriority: ['prefer_weekends'],
    });
    const homeState = { lastGameDate: null, consecutiveAway: 0, homeCount: 0, awayCount: 0, gamesByDate: new Set<string>(), gameDates: [] };
    const awayState = { ...homeState };
    const pairing: Pairing = { homeTeamId: 't1', homeTeamName: 'Alpha', awayTeamId: 't2', awayTeamName: 'Beta', round: 1, pairingIndex: 0 };
    const homeTeam = makeTeam('t1');

    const weekdaySlot = { date: '2026-04-06', venueId: 'v1', venueName: 'S', startTime: '09:00', endTime: '10:00', concurrentCapacity: 1, isFallback: false, key: 'x' }; // Monday
    const weekendSlot = { date: '2026-04-04', venueId: 'v1', venueName: 'S', startTime: '09:00', endTime: '10:00', concurrentCapacity: 1, isFallback: false, key: 'y' }; // Saturday

    const weekdayPenalty = scorePenalty(weekdaySlot, pairing, homeState, awayState, input, homeTeam);
    const weekendPenalty = scorePenalty(weekendSlot, pairing, homeState, awayState, input, homeTeam);
    expect(weekdayPenalty).toBeGreaterThan(weekendPenalty);
  });

  it('linear weights: priority 1 weight > priority 2 weight', () => {
    // With 2 constraints, weights are 3, 2 (priorityCount - i + 1)
    // prefer_weekends (i=0, weight=3) vs balance_home_away (i=1, weight=2)
    const input = baseInput({
      softConstraintPriority: ['prefer_weekends', 'balance_home_away'],
    });
    // Imbalanced home state (to trigger balance_home_away)
    const homeState = { lastGameDate: null, consecutiveAway: 0, homeCount: 5, awayCount: 0, gamesByDate: new Set<string>(), gameDates: [] };
    const awayState = { lastGameDate: null, consecutiveAway: 0, homeCount: 0, awayCount: 0, gamesByDate: new Set<string>(), gameDates: [] };
    const pairing: Pairing = { homeTeamId: 't1', homeTeamName: 'Alpha', awayTeamId: 't2', awayTeamName: 'Beta', round: 1, pairingIndex: 0 };
    const homeTeam = makeTeam('t1');

    // Weekday slot: triggers prefer_weekends (weight=3) but not balance_home_away relative penalty
    const weekdaySlot = { date: '2026-04-06', venueId: 'v1', venueName: 'S', startTime: '09:00', endTime: '10:00', concurrentCapacity: 1, isFallback: false, key: 'x' };
    const penalty = scorePenalty(weekdaySlot, pairing, homeState, awayState, input, homeTeam);
    // Should include weight of 3 for prefer_weekends (weekday)
    expect(penalty).toBeGreaterThanOrEqual(3);
  });
});

// ─── assignFixtures ───────────────────────────────────────────────────────────

describe('assignFixtures', () => {
  it('2 teams, simple season: assigns all fixtures', () => {
    const input = baseInput({
      teams: [makeTeam('t1'), makeTeam('t2')],
      format: 'single_round_robin',
      seasonStart: '2026-04-04',
      seasonEnd: '2026-04-30',
      minRestDays: 0,
    });
    const pairings = generatePairings(input);
    const slots = generateSlots(input);
    const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
    const shuffled = shufflePairings(pairings, seed);
    const result = assignFixtures(shuffled, slots, input);
    expect(result.assigned).toHaveLength(1);
    expect(result.unassigned).toHaveLength(0);
  });

  it('minRestDays: no team plays twice within rest window', () => {
    const input = baseInput({
      format: 'double_round_robin',
      minRestDays: 3,
      seasonStart: '2026-04-01',
      seasonEnd: '2026-08-31', // longer season to allow rest
    });
    const pairings = generatePairings(input);
    const slots = generateSlots(input);
    const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
    const shuffled = shufflePairings(pairings, seed);
    const result = assignFixtures(shuffled, slots, input);

    // For each assigned fixture, check that neither team played in the previous minRestDays
    const teamDates = new Map<string, string[]>();
    for (const { pairing, slot } of result.assigned) {
      for (const teamId of [pairing.homeTeamId, pairing.awayTeamId]) {
        if (!teamDates.has(teamId)) teamDates.set(teamId, []);
        const dates = teamDates.get(teamId)!;
        for (const prevDate of dates) {
          const gap = daysBetween(prevDate, slot.date);
          expect(Math.abs(gap)).toBeGreaterThanOrEqual(input.minRestDays);
        }
        dates.push(slot.date);
      }
    }
  });

  it('no same-day double-booking for a team', () => {
    const input = baseInput({
      format: 'double_round_robin',
      minRestDays: 0,
    });
    const pairings = generatePairings(input);
    const slots = generateSlots(input);
    const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
    const shuffled = shufflePairings(pairings, seed);
    const result = assignFixtures(shuffled, slots, input);

    const teamDayGames = new Map<string, Set<string>>();
    for (const { pairing, slot } of result.assigned) {
      for (const teamId of [pairing.homeTeamId, pairing.awayTeamId]) {
        if (!teamDayGames.has(teamId)) teamDayGames.set(teamId, new Set());
        const dayGames = teamDayGames.get(teamId)!;
        expect(dayGames.has(slot.date)).toBe(false);
        dayGames.add(slot.date);
      }
    }
  });

  it('returns unassigned when no valid slot exists', () => {
    // Season with no matching venue days
    const input = baseInput({
      seasonStart: '2026-04-06',
      seasonEnd: '2026-04-10', // Mon–Fri only, venue only has Sat/Sun
    });
    const pairings = generatePairings(input);
    const slots = generateSlots(input);
    const result = assignFixtures(pairings, slots, input);
    expect(result.assigned).toHaveLength(0);
    expect(result.unassigned).toHaveLength(pairings.length);
  });
});

// ─── fnv32a / shufflePairings ─────────────────────────────────────────────────

describe('fnv32a', () => {
  it('produces consistent hash for same input', () => {
    expect(fnv32a('league-1|2026-04-01')).toBe(fnv32a('league-1|2026-04-01'));
  });

  it('produces different hash for different input', () => {
    expect(fnv32a('league-1|2026-04-01')).not.toBe(fnv32a('league-2|2026-04-01'));
  });

  it('returns unsigned 32-bit integer', () => {
    const h = fnv32a('test');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xFFFFFFFF);
  });
});

describe('shufflePairings', () => {
  it('same seed produces same order', () => {
    const input = baseInput();
    const pairings = generatePairings(input);
    const seed = 12345;
    const a = shufflePairings(pairings, seed);
    const b = shufflePairings(pairings, seed);
    expect(a.map(p => p.pairingIndex)).toEqual(b.map(p => p.pairingIndex));
  });

  it('different seeds produce different orders (probabilistic)', () => {
    const input = baseInput();
    const pairings = generatePairings(input);
    const a = shufflePairings(pairings, 111);
    const b = shufflePairings(pairings, 999);
    // Very unlikely to be identical for 6-element array
    const aOrder = a.map(p => p.pairingIndex).join(',');
    const bOrder = b.map(p => p.pairingIndex).join(',');
    expect(aOrder).not.toBe(bOrder);
  });

  it('preserves all pairings (no loss or duplication)', () => {
    const input = baseInput();
    const pairings = generatePairings(input);
    const shuffled = shufflePairings(pairings, 42);
    expect(shuffled).toHaveLength(pairings.length);
    const ids = new Set(shuffled.map(p => p.pairingIndex));
    expect(ids.size).toBe(pairings.length);
  });
});

// ─── validateInput ────────────────────────────────────────────────────────────

describe('validateInput', () => {
  it('accepts valid input', () => {
    expect(() => validateInput(baseInput())).not.toThrow();
  });

  it('rejects < 2 teams', () => {
    expect(() => validateInput(baseInput({ teams: [makeTeam('t1')] }))).toThrow(/2–20/);
  });

  it('rejects > 20 teams', () => {
    const teams = Array.from({ length: 21 }, (_, i) => makeTeam(`t${i}`));
    expect(() => validateInput(baseInput({ teams }))).toThrow(/2–20/);
  });

  it('rejects invalid date format', () => {
    expect(() => validateInput(baseInput({ seasonStart: '01-04-2026' }))).toThrow(/ISO/);
  });

  it('rejects seasonEnd before seasonStart', () => {
    expect(() => validateInput(baseInput({ seasonStart: '2026-06-01', seasonEnd: '2026-05-01' }))).toThrow(/seasonEnd/);
  });

  it('rejects unknown soft constraint', () => {
    expect(() => validateInput(baseInput({
      softConstraintPriority: ['not_a_real_constraint' as never],
    }))).toThrow(/unknown soft constraint/);
  });

  it('rejects duplicate team IDs', () => {
    expect(() => validateInput(baseInput({
      teams: [makeTeam('t1'), makeTeam('t1'), makeTeam('t2'), makeTeam('t3')],
    }))).toThrow(/duplicate team id/);
  });

  it('rejects homeVenueId referencing unknown venue', () => {
    expect(() => validateInput(baseInput({
      teams: [makeTeam('t1', 'Alpha', 'nonexistent-venue'), makeTeam('t2'), makeTeam('t3'), makeTeam('t4')],
    }))).toThrow(/unknown venue/);
  });

  it('rejects doubleheader with single_round_robin', () => {
    expect(() => validateInput(baseInput({
      format: 'single_round_robin',
      doubleheader: { enabled: true, bufferMinutes: 15 },
    }))).toThrow(/double_round_robin/);
  });
});

// ─── buildOutput (integration) ────────────────────────────────────────────────

describe('buildOutput', () => {
  it('odd team count: includes ODD_TEAM_COUNT warning', () => {
    const input = baseInput({
      teams: [makeTeam('t1'), makeTeam('t2'), makeTeam('t3')],
      format: 'single_round_robin',
    });
    const pairings = generatePairings(input);
    const slots = generateSlots(input);
    const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
    const shuffled = shufflePairings(pairings, seed);
    const assignmentResult = assignFixtures(shuffled, slots, input);
    const output = buildOutput(assignmentResult, input);

    const oddWarning = output.warnings.find(w => w.code === 'ODD_TEAM_COUNT');
    expect(oddWarning).toBeDefined();
    expect(oddWarning?.message).toContain('3 teams');
  });

  it('even team count: no ODD_TEAM_COUNT warning', () => {
    const input = baseInput();
    const pairings = generatePairings(input);
    const slots = generateSlots(input);
    const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
    const shuffled = shufflePairings(pairings, seed);
    const assignmentResult = assignFixtures(shuffled, slots, input);
    const output = buildOutput(assignmentResult, input);

    const oddWarning = output.warnings.find(w => w.code === 'ODD_TEAM_COUNT');
    expect(oddWarning).toBeUndefined();
  });

  it('feasible flag is true when all pairings are assigned', () => {
    const input = baseInput({
      teams: [makeTeam('t1'), makeTeam('t2')],
      format: 'single_round_robin',
      seasonStart: '2026-04-04',
      seasonEnd: '2026-04-30',
      minRestDays: 0,
    });
    const pairings = generatePairings(input);
    const slots = generateSlots(input);
    const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
    const shuffled = shufflePairings(pairings, seed);
    const assignmentResult = assignFixtures(shuffled, slots, input);
    const output = buildOutput(assignmentResult, input);
    expect(output.stats.feasible).toBe(true);
    expect(output.stats.unassignedFixtures).toBe(0);
  });

  it('includes teamStats for all teams', () => {
    const input = baseInput();
    const pairings = generatePairings(input);
    const slots = generateSlots(input);
    const seed = fnv32a(input.leagueId + '|' + input.seasonStart);
    const shuffled = shufflePairings(pairings, seed);
    const assignmentResult = assignFixtures(shuffled, slots, input);
    const output = buildOutput(assignmentResult, input);
    expect(output.teamStats).toHaveLength(input.teams.length);
    for (const stat of output.teamStats) {
      expect(stat.homeGames + stat.awayGames).toBe(stat.totalGames);
    }
  });
});
