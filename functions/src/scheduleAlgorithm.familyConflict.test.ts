/**
 * FW-32 — Family conflict detection tests.
 *
 * Verifies that when familyConflictGroups is provided, the schedule algorithm
 * prevents two sibling teams from being assigned the same date+startTime slot.
 *
 * All tests are pure (no Firebase) — operate only on exported functions.
 */

import { describe, it, expect } from 'vitest';
import {
  assignFixtures,
  buildOutput,
  generateSlots,
  generatePairings,
  shufflePairings,
  validateInput,
  feasibilityPreCheck,
  fnv32a,
  extractFamilyConflictGroups,
  type AssignmentResult,
  type GenerateScheduleInput,
  type Pairing,
  type ScheduleVenueInput,
  type ScheduleTeamInput,
  type Slot,
} from './scheduleAlgorithm';

// ─── Shared test fixture builder ──────────────────────────────────────────────

/**
 * Builds a minimal valid GenerateScheduleInput for family-conflict tests.
 * Four concurrent pitches — enough to schedule any two games simultaneously
 * unless the family constraint blocks it.
 */
function buildInput(overrides: Partial<GenerateScheduleInput> = {}): GenerateScheduleInput {
  const defaultTeams: ScheduleTeamInput[] = [
    { id: 'sharks', name: 'Sharks' },
    { id: 'tigers', name: 'Tigers' },
    { id: 'eagles', name: 'Eagles' },
    { id: 'bears',  name: 'Bears'  },
  ];

  const venue: ScheduleVenueInput = {
    id: 'venue-1',
    name: 'Main Venue',
    concurrentPitches: 4,
    availabilityWindows: [
      { dayOfWeek: 6, startTime: '09:00', endTime: '18:00' }, // Saturdays
      { dayOfWeek: 0, startTime: '09:00', endTime: '18:00' }, // Sundays
    ],
  };

  return {
    leagueId:             'league-fw32',
    leagueName:           'FW-32 Test League',
    teams:                defaultTeams,
    venues:               [venue],
    seasonStart:          '2026-09-05',
    seasonEnd:            '2026-11-28',
    format:               'single_round_robin',
    matchDurationMinutes: 90,
    bufferMinutes:        15,
    minRestDays:          1,
    softConstraintPriority: [],
    homeAwayMode:         'relaxed',
    ...overrides,
  };
}

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

// ─── Test 1: sibling teams are not scheduled simultaneously ───────────────────

describe('FW-32 family conflict — siblings', () => {
  it('prevents two sibling teams from playing at the same date+time', () => {
    const input = buildInput({
      familyConflictGroups: [['sharks', 'tigers']],
    });

    const output = runSchedule(input);

    // When sharks is playing someone OTHER than tigers, tigers must not be
    // playing at the same date|startTime (and vice versa).
    // Direct matchups (sharks vs tigers) are excluded — they trivially share a slot.
    for (const fixture of output.fixtures) {
      const isDirectMatchup =
        (fixture.homeTeamId === 'sharks' && fixture.awayTeamId === 'tigers') ||
        (fixture.homeTeamId === 'tigers' && fixture.awayTeamId === 'sharks');
      if (isDirectMatchup) continue;

      const involvesSharks = fixture.homeTeamId === 'sharks' || fixture.awayTeamId === 'sharks';
      const involvesTigers = fixture.homeTeamId === 'tigers' || fixture.awayTeamId === 'tigers';
      if (!involvesSharks && !involvesTigers) continue;

      // This fixture involves exactly one of sharks or tigers (not a direct matchup).
      // Check no other fixture at the same date|time involves the sibling.
      const timeKey = `${fixture.date}|${fixture.startTime}`;
      const concurrent = output.fixtures.filter(
        f => f !== fixture && `${f.date}|${f.startTime}` === timeKey,
      );

      for (const other of concurrent) {
        if (involvesSharks) {
          // No concurrent fixture should involve tigers
          expect(
            other.homeTeamId === 'tigers' || other.awayTeamId === 'tigers',
            `sharks game at ${timeKey} conflicts with tigers game`,
          ).toBe(false);
        }
        if (involvesTigers) {
          // No concurrent fixture should involve sharks
          expect(
            other.homeTeamId === 'sharks' || other.awayTeamId === 'sharks',
            `tigers game at ${timeKey} conflicts with sharks game`,
          ).toBe(false);
        }
      }
    }
  });

  it('records a FAMILY_SLOT_CONFLICT soft conflict when the fallback path is taken', () => {
    // Directly exercise buildOutput with a fabricated AssignmentResult where
    // hasFamilyConflict=true. This tests the soft-conflict emission code path
    // without depending on exact slot ordering or schedule geometry.
    const input = buildInput({ familyConflictGroups: [['sharks', 'tigers']] });

    const slot: Slot = {
      date: '2026-09-05',
      venueId: 'venue-1',
      venueName: 'Main Venue',
      startTime: '09:00',
      endTime: '10:30',
      concurrentCapacity: 4,
      isFallback: false,
      key: '2026-09-05|venue-1|09:00',
    };

    const pairing: Pairing = {
      homeTeamId:   'sharks',
      homeTeamName: 'Sharks',
      awayTeamId:   'eagles',
      awayTeamName: 'Eagles',
      round:        1,
      pairingIndex: 0,
    };

    const assignmentResult: AssignmentResult = {
      assigned: [{ pairing, slot, penalty: 0, practiceConflicts: [], hasFamilyConflict: true }],
      unassigned: [],
    };

    const output = buildOutput(assignmentResult, input);

    const familyConflicts = output.conflicts.filter(
      c => c.constraintId === 'FAMILY_SLOT_CONFLICT',
    );
    expect(familyConflicts.length).toBeGreaterThan(0);

    for (const fc of familyConflicts) {
      expect(fc.severity).toBe('soft');
    }
  });
});

// ─── Test 2: non-sibling teams may be scheduled simultaneously ────────────────

describe('FW-32 family conflict — non-siblings not over-restricted', () => {
  it('allows non-sibling teams to play simultaneously', () => {
    const input = buildInput({
      // Only sharks and tigers are siblings; eagles and bears are not related to anyone
      familyConflictGroups: [['sharks', 'tigers']],
    });

    const output = runSchedule(input);

    // All fixtures should be assigned — non-sibling teams must not be over-restricted
    expect(output.fixtures.length).toBeGreaterThan(0);
    expect(output.stats.feasible).toBe(true);

    // eagles and bears should appear in the schedule
    const teams = new Set(output.fixtures.flatMap(f => [f.homeTeamId, f.awayTeamId]));
    expect(teams.has('eagles')).toBe(true);
    expect(teams.has('bears')).toBe(true);
  });
});

// ─── Test 3: empty familyConflictGroups has no effect ─────────────────────────

describe('FW-32 family conflict — empty groups', () => {
  it('produces same result as no familyConflictGroups when array is empty', () => {
    const withEmpty = buildInput({ familyConflictGroups: [] });
    const withUndefined = buildInput({});

    const outEmpty = runSchedule(withEmpty);
    const outUndef = runSchedule(withUndefined);

    // Same number of fixtures
    expect(outEmpty.fixtures.length).toBe(outUndef.fixtures.length);
    expect(outEmpty.stats.assignedFixtures).toBe(outUndef.stats.assignedFixtures);
  });
});

// ─── Test 4: single-team conflict group is ignored ───────────────────────────

describe('FW-32 family conflict — single-team group', () => {
  it('ignores groups with only one team (no sibling to conflict with)', () => {
    const withSingle = buildInput({ familyConflictGroups: [['sharks']] });
    const withUndefined = buildInput({});

    const outSingle = runSchedule(withSingle);
    const outUndef  = runSchedule(withUndefined);

    // Single-element groups must not restrict scheduling
    expect(outSingle.fixtures.length).toBe(outUndef.fixtures.length);
  });
});

// ─── Test 5: CF precomputation extraction logic (pure function unit test) ─────

describe('FW-32 family conflict — extractFamilyConflictGroups', () => {
  it('returns correct conflict groups from parent membership data', () => {
    // Simulate parent user membership data (shape mirrors Firestore users/{uid}.memberships)
    const parentUsers: Array<{
      uid: string;
      memberships: Array<{ role: string; teamId: string; playerId?: string }>;
    }> = [
      {
        uid: 'parent-1',
        memberships: [
          { role: 'parent', teamId: 'sharks', playerId: 'player-1' },
          { role: 'parent', teamId: 'tigers', playerId: 'player-2' },
        ],
      },
      {
        uid: 'parent-2',
        // Only one child — should not produce a conflict group
        memberships: [
          { role: 'parent', teamId: 'eagles', playerId: 'player-3' },
        ],
      },
      {
        uid: 'parent-3',
        // Three children — one group of three
        memberships: [
          { role: 'parent', teamId: 'bears',   playerId: 'player-4' },
          { role: 'parent', teamId: 'wolves',  playerId: 'player-5' },
          { role: 'parent', teamId: 'foxes',   playerId: 'player-6' },
        ],
      },
    ];

    const leagueTeamIds = new Set(['sharks', 'tigers', 'eagles', 'bears', 'wolves', 'foxes']);

    const groups = extractFamilyConflictGroups(parentUsers, leagueTeamIds);

    // parent-1 → ['sharks', 'tigers']
    // parent-2 → ignored (single team)
    // parent-3 → ['bears', 'wolves', 'foxes']
    expect(groups).toHaveLength(2);

    const sorted = groups.map(g => [...g].sort()).sort((a, b) => a[0].localeCompare(b[0]));
    expect(sorted[0]).toEqual(['bears', 'foxes', 'wolves']);
    expect(sorted[1]).toEqual(['sharks', 'tigers']);
  });

  it('filters out teamIds not in the league', () => {
    const parentUsers = [
      {
        uid: 'parent-cross',
        memberships: [
          { role: 'parent', teamId: 'sharks',        playerId: 'p1' },
          { role: 'parent', teamId: 'other-league',  playerId: 'p2' }, // not in league
        ],
      },
    ];

    const leagueTeamIds = new Set(['sharks', 'tigers']);
    const groups = extractFamilyConflictGroups(parentUsers, leagueTeamIds);

    // 'other-league' filtered out → only 'sharks' remains → single-team → no group
    expect(groups).toHaveLength(0);
  });

  it('deduplicates identical conflict groups from two parents sharing the same child set', () => {
    // Two parents, each with a child on sharks and a child on tigers (blended family scenario)
    const parentUsers = [
      {
        uid: 'parent-a',
        memberships: [
          { role: 'parent', teamId: 'sharks', playerId: 'p1' },
          { role: 'parent', teamId: 'tigers', playerId: 'p2' },
        ],
      },
      {
        uid: 'parent-b',
        memberships: [
          { role: 'parent', teamId: 'sharks', playerId: 'p1' },
          { role: 'parent', teamId: 'tigers', playerId: 'p2' },
        ],
      },
    ];

    const leagueTeamIds = new Set(['sharks', 'tigers']);
    const groups = extractFamilyConflictGroups(parentUsers, leagueTeamIds);

    // Despite two parents, identical group should appear only once
    expect(groups).toHaveLength(1);
    expect([...groups[0]].sort()).toEqual(['sharks', 'tigers']);
  });
});
