/**
 * Pure-function unit tests for the grid initialisation and serialisation logic
 * in CoachAvailabilityForm.
 *
 * Phase 2 update: CoachAvailabilityForm now uses AvailabilityState ('preferred'
 * | 'available' | 'unavailable') for GridState instead of a boolean.  The
 * component also reads the new `state` field from stored responses and falls
 * back to the legacy `available` boolean for old submissions.
 *
 * initGridFromResponse, gridToWindows, cycleCell, and buildDefaultGrid are not
 * exported from the component, so this file replicates the logic verbatim.
 * Any change to those functions in the component MUST be reflected here.
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
import type { CoachAvailabilityResponse, AvailabilityState } from '@/types';

// ─── Mirror of the component's internal types and helpers (Phase 2) ───────────

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

// Phase 2: GridState uses AvailabilityState, not boolean.
type GridState = Record<number, Record<Block, AvailabilityState>>;

const NEXT_STATE: Record<AvailabilityState, AvailabilityState> = {
  unavailable: 'available',
  available: 'preferred',
  preferred: 'unavailable',
};

function buildDefaultGrid(): GridState {
  const grid: GridState = {};
  for (const day of GRID_DAYS) {
    grid[day.dayOfWeek] = { morning: 'available', afternoon: 'available', evening: 'available' };
  }
  return grid;
}

function initGridFromResponse(response: CoachAvailabilityResponse): GridState {
  const grid = buildDefaultGrid();
  for (const w of response.weeklyWindows) {
    const block = BLOCKS.find(b => b.startTime === w.startTime);
    if (block && grid[w.dayOfWeek] !== undefined) {
      if (w.state) {
        grid[w.dayOfWeek][block.id] = w.state;
      } else if (w.available !== undefined) {
        // Backward compat: old submissions used boolean
        grid[w.dayOfWeek][block.id] = w.available ? 'available' : 'unavailable';
      }
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
        state: grid[day.dayOfWeek][block.id],
      });
    }
  }
  return windows;
}

function cycleCell(grid: GridState, dayOfWeek: number, block: Block): GridState {
  return {
    ...grid,
    [dayOfWeek]: {
      ...grid[dayOfWeek],
      [block]: NEXT_STATE[grid[dayOfWeek][block]],
    },
  };
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
  it('initialises every day/block combination as "available"', () => {
    const grid = buildDefaultGrid();
    for (const day of GRID_DAYS) {
      expect(grid[day.dayOfWeek].morning).toBe('available');
      expect(grid[day.dayOfWeek].afternoon).toBe('available');
      expect(grid[day.dayOfWeek].evening).toBe('available');
    }
  });

  it('uses 06:00 as the morning block start time (via BLOCKS)', () => {
    expect(BLOCKS[0].id).toBe('morning');
    expect(BLOCKS[0].startTime).toBe('06:00');
  });

  it('covers all 7 days', () => {
    const grid = buildDefaultGrid();
    expect(Object.keys(grid)).toHaveLength(7);
  });
});

// ─── NEXT_STATE cycling ───────────────────────────────────────────────────────

describe('NEXT_STATE tri-state cycle', () => {
  it('cycles unavailable → available', () => {
    expect(NEXT_STATE['unavailable']).toBe('available');
  });

  it('cycles available → preferred', () => {
    expect(NEXT_STATE['available']).toBe('preferred');
  });

  it('cycles preferred → unavailable', () => {
    expect(NEXT_STATE['preferred']).toBe('unavailable');
  });

  it('completes a full three-click cycle back to the starting state', () => {
    let state: AvailabilityState = 'available';
    state = NEXT_STATE[state]; // → preferred
    state = NEXT_STATE[state]; // → unavailable
    state = NEXT_STATE[state]; // → available
    expect(state).toBe('available');
  });
});

// ─── cycleCell ────────────────────────────────────────────────────────────────

describe('cycleCell', () => {
  it('advances a single cell from available to preferred', () => {
    const grid = buildDefaultGrid(); // all 'available'
    const next = cycleCell(grid, 1, 'morning'); // Monday morning
    expect(next[1].morning).toBe('preferred');
  });

  it('does not mutate the original grid', () => {
    const grid = buildDefaultGrid();
    cycleCell(grid, 1, 'morning');
    expect(grid[1].morning).toBe('available');
  });

  it('does not affect other cells when one is cycled', () => {
    const grid = buildDefaultGrid();
    const next = cycleCell(grid, 1, 'morning');
    // Monday afternoon and Wednesday morning should still be 'available'
    expect(next[1].afternoon).toBe('available');
    expect(next[3].morning).toBe('available');
  });

  it('cycles from preferred to unavailable', () => {
    let grid = buildDefaultGrid();
    grid = cycleCell(grid, 6, 'evening'); // available → preferred
    grid = cycleCell(grid, 6, 'evening'); // preferred → unavailable
    expect(grid[6].evening).toBe('unavailable');
  });

  it('cycles from unavailable back to available', () => {
    let grid = buildDefaultGrid();
    grid = cycleCell(grid, 0, 'afternoon'); // available → preferred
    grid = cycleCell(grid, 0, 'afternoon'); // preferred → unavailable
    grid = cycleCell(grid, 0, 'afternoon'); // unavailable → available
    expect(grid[0].afternoon).toBe('available');
  });
});

// ─── initGridFromResponse — Phase 2: state field ──────────────────────────────

describe('initGridFromResponse — new state field', () => {
  it('reads state:"preferred" from a stored response', () => {
    const response = makeResponse([
      { dayOfWeek: 6, startTime: SLOT_MORNING_START, endTime: SLOT_MORNING_END, state: 'preferred' },
    ]);
    const grid = initGridFromResponse(response);
    expect(grid[6].morning).toBe('preferred');
  });

  it('reads state:"unavailable" from a stored response', () => {
    const response = makeResponse([
      { dayOfWeek: 2, startTime: SLOT_AFTERNOON_START, endTime: SLOT_AFTERNOON_END, state: 'unavailable' },
    ]);
    const grid = initGridFromResponse(response);
    expect(grid[2].afternoon).toBe('unavailable');
  });

  it('reads state:"available" from a stored response', () => {
    const response = makeResponse([
      { dayOfWeek: 4, startTime: SLOT_EVENING_START, endTime: SLOT_EVENING_END, state: 'available' },
    ]);
    const grid = initGridFromResponse(response);
    expect(grid[4].evening).toBe('available');
  });

  it('state field takes precedence over available boolean when both are present', () => {
    // A hybrid document where state is present — state wins.
    const response = makeResponse([
      {
        dayOfWeek: 1,
        startTime: SLOT_MORNING_START,
        endTime: SLOT_MORNING_END,
        state: 'preferred',
        available: false, // would map to 'unavailable' if applied
      },
    ]);
    const grid = initGridFromResponse(response);
    expect(grid[1].morning).toBe('preferred');
  });

  it('days not mentioned in the response default to "available"', () => {
    const response = makeResponse([
      { dayOfWeek: 1, startTime: SLOT_MORNING_START, endTime: SLOT_MORNING_END, state: 'unavailable' },
    ]);
    const grid = initGridFromResponse(response);
    // Wednesday morning should be untouched default
    expect(grid[3].morning).toBe('available');
  });
});

// ─── initGridFromResponse — backward compat: legacy available boolean ──────────

describe('initGridFromResponse — backward compat (available: boolean)', () => {
  it('reads available:false as "unavailable"', () => {
    const response = makeResponse([
      { dayOfWeek: 6, startTime: SLOT_MORNING_START, endTime: SLOT_MORNING_END, state: 'available' as AvailabilityState, available: false },
    ]);
    // Construct a response that has no state field — simulate old document
    const legacyResponse: CoachAvailabilityResponse = {
      ...response,
      weeklyWindows: response.weeklyWindows.map(w => ({ ...w, state: undefined as unknown as AvailabilityState, available: false })),
    };
    const grid = initGridFromResponse(legacyResponse);
    expect(grid[6].morning).toBe('unavailable');
  });

  it('reads available:true as "available"', () => {
    const legacyResponse: CoachAvailabilityResponse = {
      coachUid: 'c1',
      coachName: 'Coach One',
      teamId: 't1',
      submittedAt: '2026-01-01T00:00:00.000Z',
      weeklyWindows: [
        { dayOfWeek: 1, startTime: SLOT_AFTERNOON_START, endTime: SLOT_AFTERNOON_END, state: undefined as unknown as AvailabilityState, available: true },
      ],
      dateOverrides: [],
    };
    const grid = initGridFromResponse(legacyResponse);
    expect(grid[1].afternoon).toBe('available');
  });

  it('falls back gracefully: unrecognised start time (legacy 08:00) is dropped without data corruption', () => {
    const legacyResponse = makeResponse([
      // Legacy morning window — 08:00 was the old modal default.
      { dayOfWeek: 1, startTime: '08:00', endTime: '12:00', state: 'unavailable' },
      // Afternoon window with current boundary — should load normally.
      { dayOfWeek: 1, startTime: SLOT_AFTERNOON_START, endTime: SLOT_AFTERNOON_END, state: 'unavailable' },
    ]);
    const grid = initGridFromResponse(legacyResponse);
    // Morning defaults to 'available' because the legacy window was skipped, not corrupted.
    expect(grid[1].morning).toBe('available');
    // Afternoon window is recognised and applied.
    expect(grid[1].afternoon).toBe('unavailable');
  });

  it('still processes recognised windows alongside the legacy one', () => {
    const legacyResponse = makeResponse([
      { dayOfWeek: 1, startTime: '08:00', endTime: '12:00', state: 'unavailable' },
      { dayOfWeek: 1, startTime: SLOT_AFTERNOON_START, endTime: SLOT_AFTERNOON_END, state: 'preferred' },
    ]);
    const grid = initGridFromResponse(legacyResponse);
    expect(grid[1].afternoon).toBe('preferred');
  });

  it('leaves all other days untouched when loading a legacy response', () => {
    const legacyResponse = makeResponse([
      { dayOfWeek: 1, startTime: '08:00', endTime: '12:00', state: 'unavailable' },
    ]);
    const grid = initGridFromResponse(legacyResponse);
    // Wednesday was not mentioned — every block should be 'available'.
    expect(grid[3].morning).toBe('available');
    expect(grid[3].afternoon).toBe('available');
    expect(grid[3].evening).toBe('available');
  });
});

// ─── initGridFromResponse — new response (no prior data) ─────────────────────

describe('initGridFromResponse — new response (no prior data)', () => {
  it('grid produced from buildDefaultGrid emits 06:00 as the morning start', () => {
    const grid = buildDefaultGrid();
    const windows = gridToWindows(grid);
    const mondayMorning = windows.find(w => w.dayOfWeek === 1 && w.startTime === SLOT_MORNING_START);
    expect(mondayMorning).toBeDefined();
    expect(mondayMorning!.startTime).toBe('06:00');
  });
});

// ─── gridToWindows ────────────────────────────────────────────────────────────

describe('gridToWindows', () => {
  it('emits 06:00 as the morning startTime regardless of what the loaded response contained', () => {
    const legacyResponse = makeResponse([
      { dayOfWeek: 1, startTime: '08:00', endTime: '12:00', state: 'unavailable' },
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

  it('serialises state field, not available boolean', () => {
    const grid = buildDefaultGrid();
    const windows = gridToWindows(grid);
    // Every emitted window should carry state, not the old available flag.
    for (const w of windows) {
      expect(w.state).toBeDefined();
      expect(['preferred', 'available', 'unavailable']).toContain(w.state);
    }
  });

  it('round-trips preferred state through gridToWindows', () => {
    let grid = buildDefaultGrid();
    grid = cycleCell(grid, 6, 'morning'); // available → preferred
    const windows = gridToWindows(grid);
    const satMorning = windows.find(w => w.dayOfWeek === 6 && w.startTime === SLOT_MORNING_START);
    expect(satMorning?.state).toBe('preferred');
  });

  it('round-trips unavailable state through gridToWindows', () => {
    let grid = buildDefaultGrid();
    grid = cycleCell(grid, 3, 'evening'); // available → preferred
    grid = cycleCell(grid, 3, 'evening'); // preferred → unavailable
    const windows = gridToWindows(grid);
    const thuEvening = windows.find(w => w.dayOfWeek === 4 && w.startTime === SLOT_EVENING_START);
    // Thursday is dayOfWeek 4
    const thuEveningCorrect = windows.find(w => w.dayOfWeek === 4 && w.startTime === SLOT_EVENING_START);
    // Wednesday (3) evening should be unavailable
    const wedEvening = windows.find(w => w.dayOfWeek === 3 && w.startTime === SLOT_EVENING_START);
    expect(wedEvening?.state).toBe('unavailable');
    void thuEvening; void thuEveningCorrect; // suppress unused-var warning
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
        available: w.available ?? (w.state !== 'unavailable'),
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
    { dayOfWeek: 1, startTime: '08:00', endTime: '12:00', state: 'available' },
    // A recognisable afternoon window.
    { dayOfWeek: 1, startTime: SLOT_AFTERNOON_START, endTime: SLOT_AFTERNOON_END, state: 'unavailable' },
  ]);

  it('legacy 08:00 window is skipped — morning cell is not corrupted', () => {
    const g = initModalGridFromResponse(legacyResponse);
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
    const response = makeResponse([
      { dayOfWeek: 2, startTime: SLOT_EVENING_START, endTime: SLOT_EVENING_END, state: 'unavailable' },
    ]);
    const g = initModalGridFromResponse(response);
    expect(g[2].evening.startTime).toBe(SLOT_EVENING_START);
    expect(g[2].evening.endTime).toBe(SLOT_EVENING_END);
  });

  it('unrelated days are untouched after loading a legacy response', () => {
    const g = initModalGridFromResponse(legacyResponse);
    expect(g[3].morning.startTime).toBe('06:00');
    expect(g[3].morning.available).toBe(true);
  });
});
