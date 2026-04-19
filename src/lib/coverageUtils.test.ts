import { describe, it, expect } from 'vitest';
import {
  windowOverlapsSlot,
  getCellCoverage,
  getTopCoverageSlots,
  HEATMAP_SLOTS,
  SLOT_MORNING_START,
  SLOT_MORNING_END,
  SLOT_AFTERNOON_START,
  SLOT_AFTERNOON_END,
  SLOT_EVENING_START,
  SLOT_EVENING_END,
} from '@/lib/coverageUtils';
import type { CoachAvailabilityResponse } from '@/types';

// ─── windowOverlapsSlot ───────────────────────────────────────────────────────

describe('windowOverlapsSlot', () => {
  // Slot under test: 12:00 – 17:00 (Afternoon)
  const SS = '12:00';
  const SE = '17:00';

  it('returns true when window fully contains the slot', () => {
    expect(windowOverlapsSlot('10:00', '18:00', SS, SE)).toBe(true);
  });

  it('returns true when window starts before and ends during the slot', () => {
    expect(windowOverlapsSlot('10:00', '14:00', SS, SE)).toBe(true);
  });

  it('returns true when window starts during the slot and ends after', () => {
    expect(windowOverlapsSlot('14:00', '20:00', SS, SE)).toBe(true);
  });

  it('returns false when window is completely before the slot', () => {
    expect(windowOverlapsSlot('06:00', '11:00', SS, SE)).toBe(false);
  });

  it('returns false when window is completely after the slot', () => {
    expect(windowOverlapsSlot('17:30', '22:00', SS, SE)).toBe(false);
  });

  it('returns true when window exactly matches slot boundaries', () => {
    expect(windowOverlapsSlot('12:00', '17:00', SS, SE)).toBe(true);
  });

  it('returns false when window ends exactly at slot start (no overlap)', () => {
    // ws=10:00 we=12:00, ss=12:00 se=17:00 → we > ss is false (600 > 720 = false... wait)
    // Actually: ws=10:00(600) we=12:00(720) ss=12:00(720) se=17:00(1020)
    // ws < se → 600 < 1020 ✓  but  we > ss → 720 > 720 → false  → overall false
    expect(windowOverlapsSlot('10:00', '12:00', SS, SE)).toBe(false);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResponse(
  coachUid: string,
  teamId: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  available = true,
): CoachAvailabilityResponse {
  return {
    coachUid,
    coachName: `Coach ${coachUid}`,
    teamId,
    submittedAt: '2026-03-01T10:00:00.000Z',
    weeklyWindows: [{ dayOfWeek, startTime, endTime, available }],
    dateOverrides: [],
  };
}

// Use Monday (1) + Afternoon slot (12:00–17:00) as the target cell.
const DAY = 1;
const AFTERNOON = HEATMAP_SLOTS[1]; // { label: 'Afternoon', start: '12:00', end: '17:00' }

// ─── getCellCoverage ──────────────────────────────────────────────────────────

describe('getCellCoverage', () => {
  it('returns coverage 0 and all teams as missing when there are no responses', () => {
    const allTeamIds = ['t1', 't2', 't3'];
    const nameById = { t1: 'Rockets', t2: 'Stars', t3: 'Comets' };
    const result = getCellCoverage(DAY, AFTERNOON, [], allTeamIds, nameById);
    expect(result.available).toBe(0);
    expect(result.missingTeams).toEqual(expect.arrayContaining(['Rockets', 'Stars', 'Comets']));
    expect(result.missingTeams).toHaveLength(3);
  });

  it('returns coverage equal to total responses and empty missingTeams when all teams are available', () => {
    const responses = [
      makeResponse('c1', 't1', DAY, '12:00', '17:00'),
      makeResponse('c2', 't2', DAY, '13:00', '16:00'),
      makeResponse('c3', 't3', DAY, '11:00', '18:00'),
    ];
    const allTeamIds = ['t1', 't2', 't3'];
    const nameById = { t1: 'Rockets', t2: 'Stars', t3: 'Comets' };
    const result = getCellCoverage(DAY, AFTERNOON, responses, allTeamIds, nameById);
    expect(result.available).toBe(3);
    expect(result.missingTeams).toEqual([]);
  });

  it('returns correct partial coverage when only half the teams are available', () => {
    // t1 and t2 respond for the slot; t3 and t4 do not.
    const responses = [
      makeResponse('c1', 't1', DAY, '12:00', '17:00'),
      makeResponse('c2', 't2', DAY, '13:00', '16:00'),
      // c3/t3 responds on a DIFFERENT day (Wednesday=3), so does not cover Monday
      makeResponse('c3', 't3', 3, '12:00', '17:00'),
    ];
    const allTeamIds = ['t1', 't2', 't3', 't4'];
    const nameById = { t1: 'Rockets', t2: 'Stars', t3: 'Comets', t4: 'Eagles' };
    const result = getCellCoverage(DAY, AFTERNOON, responses, allTeamIds, nameById);
    expect(result.available).toBe(2);
    // t3 is in allTeamIds but its coach didn't cover Monday afternoon; t4 has no response at all
    expect(result.missingTeams).toContain('Comets');
    expect(result.missingTeams).toContain('Eagles');
    expect(result.missingTeams).not.toContain('Rockets');
    expect(result.missingTeams).not.toContain('Stars');
  });
});

// ─── getTopCoverageSlots ──────────────────────────────────────────────────────

describe('getTopCoverageSlots', () => {
  it('returns an empty array when responses is empty', () => {
    expect(getTopCoverageSlots([], [], {}, 5)).toEqual([]);
  });

  it('returns slots sorted by ratio descending', () => {
    // Two coaches: c1 covers Monday morning, c2 covers Monday morning + afternoon.
    // Monday morning → 2/2 = 1.0; Monday afternoon → 1/2 = 0.5; everything else → 0.
    const responses: CoachAvailabilityResponse[] = [
      {
        coachUid: 'c1',
        coachName: 'Alice',
        teamId: 't1',
        submittedAt: '2026-03-01T10:00:00.000Z',
        weeklyWindows: [{ dayOfWeek: 1, startTime: '06:00', endTime: '12:00', available: true }],
        dateOverrides: [],
      },
      {
        coachUid: 'c2',
        coachName: 'Bob',
        teamId: 't2',
        submittedAt: '2026-03-01T10:00:00.000Z',
        weeklyWindows: [
          { dayOfWeek: 1, startTime: '06:00', endTime: '12:00', available: true },
          { dayOfWeek: 1, startTime: '12:00', endTime: '17:00', available: true },
        ],
        dateOverrides: [],
      },
    ];

    const result = getTopCoverageSlots(responses, ['t1', 't2'], { t1: 'Rockets', t2: 'Stars' }, 5);

    // First slot must have the highest ratio
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].ratio).toBe(1.0);
    // All results must be in descending order
    for (let i = 1; i < result.length; i++) {
      expect(result[i].ratio).toBeLessThanOrEqual(result[i - 1].ratio);
    }
  });

  it('returns no more than the requested topN slots', () => {
    const responses: CoachAvailabilityResponse[] = [
      {
        coachUid: 'c1',
        coachName: 'Alice',
        teamId: 't1',
        submittedAt: '2026-03-01T10:00:00.000Z',
        weeklyWindows: [
          { dayOfWeek: 1, startTime: '06:00', endTime: '23:59', available: true },
          { dayOfWeek: 2, startTime: '06:00', endTime: '23:59', available: true },
          { dayOfWeek: 3, startTime: '06:00', endTime: '23:59', available: true },
        ],
        dateOverrides: [],
      },
    ];
    const result = getTopCoverageSlots(responses, ['t1'], { t1: 'Rockets' }, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('only returns slots with ratio > 0', () => {
    // One coach covers only Monday morning; all other cells have ratio 0.
    const responses: CoachAvailabilityResponse[] = [
      {
        coachUid: 'c1',
        coachName: 'Alice',
        teamId: 't1',
        submittedAt: '2026-03-01T10:00:00.000Z',
        weeklyWindows: [{ dayOfWeek: 1, startTime: '07:00', endTime: '11:00', available: true }],
        dateOverrides: [],
      },
    ];
    const result = getTopCoverageSlots(responses, ['t1'], { t1: 'Rockets' }, 10);
    expect(result.every(s => s.ratio > 0)).toBe(true);
  });
});

// ─── Slot boundary constants ──────────────────────────────────────────────────

describe('slot boundary constants', () => {
  it('slot boundary constants match expected values', () => {
    expect(SLOT_MORNING_START).toBe('06:00');
    expect(SLOT_MORNING_END).toBe('12:00');
    expect(SLOT_AFTERNOON_START).toBe('12:00');
    expect(SLOT_AFTERNOON_END).toBe('17:00');
    expect(SLOT_EVENING_START).toBe('17:00');
    expect(SLOT_EVENING_END).toBe('22:00');
  });
});
