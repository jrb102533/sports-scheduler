/**
 * Pure-function unit tests for the grid initialisation and serialisation logic
 * in CoachAvailabilityForm.
 *
 * initGridFromResponse and gridToWindows are not exported from the component, so
 * this test file replicates the logic verbatim and tests it in isolation.  Any
 * change to those functions in the component should be reflected here.
 */

import { describe, it, expect } from 'vitest';
import {
  SLOT_MORNING_START,
  SLOT_MORNING_END,
  SLOT_AFTERNOON_START,
  SLOT_AFTERNOON_END,
  SLOT_EVENING_START,
  SLOT_EVENING_END,
} from '@/lib/coverageUtils';
import type { CoachAvailabilityResponse } from '@/types';

// ─── Mirror of the component's internal types and helpers ─────────────────────

type Block = 'morning' | 'afternoon' | 'evening';

const GRID_DAYS: { label: string; dayOfWeek: number }[] = [
  { label: 'Mon', dayOfWeek: 1 },
  { label: 'Tue', dayOfWeek: 2 },
  { label: 'Wed', dayOfWeek: 3 },
  { label: 'Thu', dayOfWeek: 4 },
  { label: 'Fri', dayOfWeek: 5 },
  { label: 'Sat', dayOfWeek: 6 },
  { label: 'Sun', dayOfWeek: 0 },
];

const BLOCKS: { id: Block; label: string; startTime: string; endTime: string }[] = [
  { id: 'morning',   label: 'Morning',   startTime: SLOT_MORNING_START,   endTime: SLOT_MORNING_END   },
  { id: 'afternoon', label: 'Afternoon', startTime: SLOT_AFTERNOON_START, endTime: SLOT_AFTERNOON_END },
  { id: 'evening',   label: 'Evening',   startTime: SLOT_EVENING_START,   endTime: SLOT_EVENING_END   },
];

type GridState = Record<number, Record<Block, boolean>>;

function buildDefaultGrid(): GridState {
  const grid: GridState = {};
  for (const day of GRID_DAYS) {
    grid[day.dayOfWeek] = { morning: true, afternoon: true, evening: true };
  }
  return grid;
}

function initGridFromResponse(response: CoachAvailabilityResponse): GridState {
  const grid = buildDefaultGrid();
  for (const w of response.weeklyWindows) {
    const block = BLOCKS.find(b => b.startTime === w.startTime);
    if (block && grid[w.dayOfWeek] !== undefined) {
      grid[w.dayOfWeek][block.id] = w.available;
    }
  }
  return grid;
}

function gridToWindows(grid: GridState): CoachAvailabilityResponse['weeklyWindows'] {
  const windows: CoachAvailabilityResponse['weeklyWindows'] = [];
  for (const day of GRID_DAYS) {
    for (const block of BLOCKS) {
      windows.push({
        dayOfWeek: day.dayOfWeek,
        startTime: block.startTime,
        endTime: block.endTime,
        available: grid[day.dayOfWeek][block.id],
      });
    }
  }
  return windows;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResponse(windows: CoachAvailabilityResponse['weeklyWindows']): CoachAvailabilityResponse {
  return {
    coachUid: 'c1',
    coachName: 'Coach One',
    teamId: 't1',
    submittedAt: '2026-03-01T10:00:00.000Z',
    weeklyWindows: windows,
    dateOverrides: [],
  };
}

// ─── buildDefaultGrid ─────────────────────────────────────────────────────────

describe('buildDefaultGrid', () => {
  it('initialises every day/block combination as available', () => {
    const grid = buildDefaultGrid();
    for (const day of GRID_DAYS) {
      expect(grid[day.dayOfWeek].morning).toBe(true);
      expect(grid[day.dayOfWeek].afternoon).toBe(true);
      expect(grid[day.dayOfWeek].evening).toBe(true);
    }
  });

  it('uses 06:00 as the morning block start time (via BLOCKS)', () => {
    // Verify BLOCKS[0] carries the current canonical start, not the legacy 08:00 value.
    expect(BLOCKS[0].id).toBe('morning');
    expect(BLOCKS[0].startTime).toBe('06:00');
  });
});

// ─── initGridFromResponse — fresh response ────────────────────────────────────

describe('initGridFromResponse — new response (no prior data)', () => {
  it('grid produced from buildDefaultGrid has morning starting at 06:00', () => {
    // When there is no existingResponse the component calls buildDefaultGrid().
    // The grid is boolean-only (available flags), but the blocks it serialises
    // through gridToWindows must emit 06:00 as the morning start.
    const grid = buildDefaultGrid();
    const windows = gridToWindows(grid);
    const mondayMorning = windows.find(w => w.dayOfWeek === 1 && w.startTime === SLOT_MORNING_START);
    expect(mondayMorning).toBeDefined();
    expect(mondayMorning!.startTime).toBe('06:00');
  });
});

// ─── initGridFromResponse — legacy 08:00 response ────────────────────────────

describe('initGridFromResponse — legacy 08:00 morning start', () => {
  // Before the fix the modal default was 08:00, so some coaches have stored
  // responses with startTime: '08:00' for the morning slot.  No BLOCK matches
  // '08:00', so the window is silently dropped by the guard:
  //   if (block && grid[w.dayOfWeek] !== undefined) { ... }
  // The grid retains the buildDefaultGrid() value: morning = true (available).

  const legacyResponse = makeResponse([
    // Legacy morning window — 08:00 was the old modal default.
    { dayOfWeek: 1, startTime: '08:00', endTime: '12:00', available: true },
    // Afternoon window with the current boundary — should load normally.
    { dayOfWeek: 1, startTime: SLOT_AFTERNOON_START, endTime: SLOT_AFTERNOON_END, available: false },
  ]);

  it('falls back gracefully: unrecognised 08:00 window is dropped without data corruption', () => {
    const grid = initGridFromResponse(legacyResponse);
    // Morning defaults to true because the legacy window was skipped, not corrupted.
    expect(grid[1].morning).toBe(true);
  });

  it('still processes recognised windows alongside the legacy one', () => {
    const grid = initGridFromResponse(legacyResponse);
    // The afternoon window (12:00) IS recognised and should override the default.
    expect(grid[1].afternoon).toBe(false);
  });

  it('leaves all other days untouched', () => {
    const grid = initGridFromResponse(legacyResponse);
    // Wednesday was not mentioned in the response — every block should be true.
    expect(grid[3].morning).toBe(true);
    expect(grid[3].afternoon).toBe(true);
    expect(grid[3].evening).toBe(true);
  });
});

// ─── Modal mirror: CoachAvailabilityModal's initGridFromResponse ──────────────
//
// The modal uses a richer DayBlock (startTime, endTime, customised) and its BLOCKS
// shape uses `defaultStart`/`defaultEnd` instead of `startTime`/`endTime`.
// The fixed implementation skips unrecognised windows instead of falling back to
// BLOCKS[0] and clobbering the cell with the legacy startTime.

type ModalBlock = 'morning' | 'afternoon' | 'evening';

interface ModalDayBlock {
  available: boolean;
  startTime: string;
  endTime: string;
  customised: boolean;
}

type ModalGridState = Record<number, Record<ModalBlock, ModalDayBlock>>;

const MODAL_BLOCKS: { id: ModalBlock; label: string; defaultStart: string; defaultEnd: string }[] = [
  { id: 'morning',   label: 'Morning',   defaultStart: SLOT_MORNING_START,   defaultEnd: SLOT_MORNING_END   },
  { id: 'afternoon', label: 'Afternoon', defaultStart: SLOT_AFTERNOON_START, defaultEnd: SLOT_AFTERNOON_END },
  { id: 'evening',   label: 'Evening',   defaultStart: SLOT_EVENING_START,   defaultEnd: SLOT_EVENING_END   },
];

function buildModalDefaultGrid(): ModalGridState {
  const grid: ModalGridState = {};
  for (let d = 0; d < 7; d++) {
    grid[d] = {} as Record<ModalBlock, ModalDayBlock>;
    for (const b of MODAL_BLOCKS) {
      grid[d][b.id] = { available: true, startTime: b.defaultStart, endTime: b.defaultEnd, customised: false };
    }
  }
  return grid;
}

/** Mirror of the FIXED CoachAvailabilityModal initGridFromResponse logic. */
function initModalGridFromResponse(response: CoachAvailabilityResponse): ModalGridState {
  const g = buildModalDefaultGrid();
  for (const w of response.weeklyWindows) {
    const block = MODAL_BLOCKS.find(b => b.defaultStart === w.startTime);
    if (block && g[w.dayOfWeek] !== undefined) {
      g[w.dayOfWeek][block.id] = {
        available: w.available,
        startTime: block.defaultStart,
        endTime: block.defaultEnd,
        customised: false,
      };
    }
  }
  return g;
}

// ─── Modal: initGridFromResponse — legacy 08:00 response ─────────────────────

describe('CoachAvailabilityModal initGridFromResponse — legacy 08:00 morning start', () => {
  const legacyResponse = makeResponse([
    // Legacy morning window stored with old incorrect default.
    { dayOfWeek: 1, startTime: '08:00', endTime: '12:00', available: true },
    // A recognisable afternoon window.
    { dayOfWeek: 1, startTime: SLOT_AFTERNOON_START, endTime: SLOT_AFTERNOON_END, available: false },
  ]);

  it('legacy 08:00 window is skipped — morning cell is not corrupted', () => {
    const g = initModalGridFromResponse(legacyResponse);
    // The window carried startTime '08:00' which matches no block; it must be skipped.
    // The cell retains the buildDefaultGrid value: startTime === '06:00'.
    expect(g[1].morning.startTime).toBe('06:00');
  });

  it('morning cell retains canonical 06:00 after loading a legacy response', () => {
    const g = initModalGridFromResponse(legacyResponse);
    expect(g[1].morning.startTime).toBe(SLOT_MORNING_START);
  });

  it('morning cell availability defaults to true when the legacy window is skipped', () => {
    const g = initModalGridFromResponse(legacyResponse);
    expect(g[1].morning.available).toBe(true);
  });

  it('recognised windows alongside the legacy one are still applied', () => {
    const g = initModalGridFromResponse(legacyResponse);
    // Afternoon window is canonical and must be loaded.
    expect(g[1].afternoon.available).toBe(false);
  });

  it('cell startTime always comes from block.defaultStart, not w.startTime', () => {
    // Even if a recognised window is loaded, the stored time uses the block canonical.
    const response = makeResponse([
      { dayOfWeek: 2, startTime: SLOT_EVENING_START, endTime: SLOT_EVENING_END, available: false },
    ]);
    const g = initModalGridFromResponse(response);
    expect(g[2].evening.startTime).toBe(SLOT_EVENING_START);
    expect(g[2].evening.endTime).toBe(SLOT_EVENING_END);
  });

  it('unrelated days are untouched after loading a legacy response', () => {
    const g = initModalGridFromResponse(legacyResponse);
    // Wednesday (dayOfWeek 3) was not in the response — all blocks default to true / 06:00.
    expect(g[3].morning.startTime).toBe('06:00');
    expect(g[3].morning.available).toBe(true);
  });
});

// ─── gridToWindows — canonical start times on submit ─────────────────────────

describe('gridToWindows', () => {
  it('emits 06:00 as the morning startTime regardless of what the loaded response contained', () => {
    // Simulate a coach who loaded from a legacy 08:00 response and then submits.
    // initGridFromResponse dropped the legacy window, so morning defaults to true.
    // On submit, gridToWindows must serialise using BLOCKS[].startTime = '06:00'.
    const legacyResponse = makeResponse([
      { dayOfWeek: 1, startTime: '08:00', endTime: '12:00', available: true },
    ]);
    const grid = initGridFromResponse(legacyResponse);
    const windows = gridToWindows(grid);

    const mondayMorning = windows.find(w => w.dayOfWeek === 1 && w.startTime === '06:00');
    expect(mondayMorning).toBeDefined();
    expect(mondayMorning!.startTime).toBe('06:00');
  });

  it('never emits the legacy 08:00 start time', () => {
    const grid = buildDefaultGrid();
    const windows = gridToWindows(grid);
    expect(windows.every(w => w.startTime !== '08:00')).toBe(true);
  });

  it('emits one window per day per block (21 windows total)', () => {
    const grid = buildDefaultGrid();
    const windows = gridToWindows(grid);
    expect(windows).toHaveLength(21); // 7 days × 3 blocks
  });
});
