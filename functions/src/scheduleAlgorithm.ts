/**
 * Deterministic Schedule Algorithm — pure helper functions.
 * No Firebase calls here; all helpers are testable in isolation.
 * Implements the spec in docs/algorithm-spec-schedule.md v1.1
 */

import { HttpsError } from 'firebase-functions/v2/https';

// ─── §1 Input Schema ─────────────────────────────────────────────────────────

export interface RecurringVenueWindowSched {
  dayOfWeek: number;   // 0 = Sunday … 6 = Saturday
  startTime: string;   // "HH:MM" 24-hour
  endTime:   string;   // "HH:MM" 24-hour; must be > startTime
}

export interface ScheduleTeamInput {
  id:           string;
  name:         string;
  homeVenueId?: string;
}

export interface ScheduleSurfaceInput {
  id: string;
  name: string;
  /** Per-surface availability override; inherits from venue if absent. */
  availabilityWindows?: RecurringVenueWindowSched[];
  blackoutDates?: string[];
}

export interface DivisionInput {
  id: string;
  name: string;
  teamIds: string[];
  format: 'single_round_robin' | 'double_round_robin';
  gamesPerTeam?: number;
  /** Overrides top-level matchDuration if set. */
  matchDurationMinutes?: number;
  surfacePreferences?: Array<{
    venueId: string;
    surfaceId: string;
    preference: 'required' | 'preferred';
  }>;
  /**
   * Per-division coach availability enforcement mode.
   * - 'soft' (default): unavailable slots incur a penalty but are still eligible
   * - 'hard': unavailable slots are completely excluded (hard blackout)
   */
  enforcement?: 'soft' | 'hard';
}

export interface DivisionScheduleResult {
  divisionId: string;
  divisionName: string;
  fixtures: GeneratedFixture[];
  unassignedCount: number;
}

export interface ScheduleVenueInput {
  id:                  string;
  name:                string;
  /** @deprecated — use surfaces instead */
  concurrentPitches:   number;
  availabilityWindows: RecurringVenueWindowSched[];
  fallbackWindows?:    RecurringVenueWindowSched[];
  blackoutDates?:      string[];
  surfaces?:           ScheduleSurfaceInput[];
}

export type AvailabilityState = 'preferred' | 'available' | 'unavailable';

export interface CoachAvailabilityInput {
  teamId:   string;
  weeklyWindows: {
    dayOfWeek: number;
    startTime: string;
    endTime:   string;
    /** Three-state availability (Phase 2). Takes precedence over `available` when present. */
    state?: AvailabilityState;
    /** Legacy boolean — kept for backward compatibility. Used when `state` is absent. */
    available?: boolean;
  }[];
  dateOverrides: {
    start:     string;
    end:       string;
    available: false;
    reason?: string;
  }[];
}

export type SoftConstraintId =
  | 'prefer_weekends'
  | 'balance_home_away'
  | 'minimise_doubleheaders'
  | 'respect_coach_availability'
  | 'avoid_practice_conflicts'
  | 'min_rest_days'
  | 'max_consecutive_away';

export interface DoubleheaderConfig {
  enabled:       boolean;
  bufferMinutes: number;
}

export interface GenerateScheduleInput {
  leagueId:   string;
  leagueName: string;
  teams:  ScheduleTeamInput[];
  venues: ScheduleVenueInput[];
  seasonStart:          string;
  seasonEnd:            string;
  format:               'single_round_robin' | 'double_round_robin';
  matchDurationMinutes: number;
  bufferMinutes:        number;
  minRestDays:          number;
  blackoutDates?: string[];
  softConstraintPriority: SoftConstraintId[];
  coachAvailability?: CoachAvailabilityInput[];
  doubleheader?: DoubleheaderConfig;
  homeAwayMode: 'strict' | 'relaxed';
  homeVenueEnforcement?: 'hard' | 'soft';
  practiceEvents?: Array<{
    teamId: string;
    date: string;
    startTime: string;
    endTime: string;
    reschedulable: boolean;
  }>;
  maxConsecutiveAway?: number;
  gamesPerTeam?: number;
  divisions?: DivisionInput[];
}

// ─── §2 Output Schema ────────────────────────────────────────────────────────

export interface GeneratedFixture {
  round:         number;
  homeTeamId:    string;
  homeTeamName:  string;
  awayTeamId:    string;
  awayTeamName:  string;
  date:          string;
  startTime:     string;
  endTime:       string;
  venueId:       string;
  venueName:     string;
  isDoubleheader: boolean;
  doubleheaderSlot?: 1 | 2;
  isFallbackSlot:  boolean;
  divisionId?: string;
}

export interface ScheduleConflict {
  severity:     'hard' | 'soft';
  constraintId: string;
  description:  string;
  fixtureIndex?: number;
  teamId?:       string;
}

export interface TeamScheduleStats {
  teamId:         string;
  teamName:       string;
  totalGames:     number;
  homeGames:      number;
  awayGames:      number;
  maxRestGap:     number;
  minRestGap:     number;
  byeRounds:      number;
  byeRound?:      number;
}

export interface ScheduleAlgorithmOutput {
  fixtures:          GeneratedFixture[];
  unassignedPairings: Array<{
    homeTeamId:  string;
    homeTeamName: string;
    awayTeamId:  string;
    awayTeamName: string;
    reason:      string;
  }>;
  conflicts:  ScheduleConflict[];
  teamStats:  TeamScheduleStats[];
  stats: {
    totalFixturesRequired:  number;
    assignedFixtures:       number;
    unassignedFixtures:     number;
    fallbackSlotsUsed:      number;
    feasible:               boolean;
  };
  summary: string;
  warnings: Array<{
    code: string;
    message: string;
  }>;
  divisionResults?: DivisionScheduleResult[];
}

// ─── Internal types ──────────────────────────────────────────────────────────

export interface Slot {
  date:                string;   // ISO "YYYY-MM-DD"
  venueId:             string;
  venueName:           string;
  /** Present when generated by surface-aware path. */
  surfaceId?:          string;
  /** Human-readable name of the surface/field; present when surfaceId is present. */
  surfaceName?:        string;
  startTime:           string;   // "HH:MM"
  endTime:             string;   // "HH:MM"
  concurrentCapacity:  number;
  isFallback:          boolean;
  key:                 string;   // "date|venueId|startTime" (legacy) or "date|venueId|surfaceId|startTime" (surface-aware)
}

export interface Pairing {
  homeTeamId:   string;
  homeTeamName: string;
  awayTeamId:   string;
  awayTeamName: string;
  round:        number;
  pairingIndex: number;
}

interface TeamState {
  lastGameDate:     string | null;
  consecutiveAway:  number;
  homeCount:        number;
  awayCount:        number;
  gamesByDate:      Set<string>;
  gameDates:        string[];   // sorted list of assigned dates for gap calculation
}

export interface AssignmentResult {
  assigned: Array<{
    pairing: Pairing;
    slot: Slot;
    penalty: number;
    practiceConflicts: Array<{ teamId: string; teamName: string }>;
  }>;
  unassigned: Array<{
    pairing: Pairing;
    reason: string;
  }>;
}

// ─── Utility helpers ─────────────────────────────────────────────────────────

/** Parse "HH:MM" string to total minutes since midnight. */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Format total minutes since midnight back to "HH:MM". */
function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Count calendar days between two ISO date strings (positive = b is later). */
export function daysBetween(a: string, b: string): number {
  const msPerDay = 86_400_000;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / msPerDay);
}

/** Generate all ISO dates in [start, end] inclusive. */
function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/** Day of week from ISO date string (0=Sun…6=Sat). */
function dayOfWeek(isoDate: string): number {
  return new Date(isoDate + 'T00:00:00Z').getUTCDay();
}

/** True if the ISO date falls on a weekday (Mon–Fri). */
function isWeekday(isoDate: string): boolean {
  const d = dayOfWeek(isoDate);
  return d >= 1 && d <= 5;
}

// ─── §3 Step 3 — Seed / PRNG ──────────────────────────────────────────────

/** FNV-1a 32-bit hash. Returns unsigned 32-bit integer. */
export function fnv32a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 PRNG — returns a function that yields floats in [0,1). */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = s + 0x6d2b79f5 | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle with seeded PRNG. Returns a new array. */
export function shufflePairings(pairings: Pairing[], seed: number): Pairing[] {
  const arr = [...pairings];
  const rng = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── §1.2 Input Validation ────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const VALID_SOFT_CONSTRAINTS = new Set<SoftConstraintId>([
  'prefer_weekends',
  'balance_home_away',
  'minimise_doubleheaders',
  'respect_coach_availability',
  'avoid_practice_conflicts',
  'min_rest_days',
  'max_consecutive_away',
]);

export function validateInput(input: GenerateScheduleInput): void {
  const err = (msg: string) => { throw new HttpsError('invalid-argument', msg); };

  // SEC-18: leagueId must be a non-empty string
  if (!input.leagueId || typeof input.leagueId !== 'string' || input.leagueId.trim() === '')
    err('leagueId is required');

  // SEC-19: Team and venue counts (caps prevent DoS via oversized arrays)
  if (!Array.isArray(input.teams) || input.teams.length < 2 || input.teams.length > 64)
    err('teams must contain 2–64 entries');
  if (!Array.isArray(input.venues) || input.venues.length < 1 || input.venues.length > 32)
    err('venues must contain 1–32 entries');

  // Date formats
  if (!ISO_DATE_RE.test(input.seasonStart) || !ISO_DATE_RE.test(input.seasonEnd))
    err('dates must be ISO format YYYY-MM-DD');

  // Season span
  const span = daysBetween(input.seasonStart, input.seasonEnd);
  if (span < 1 || span > 365)
    err('seasonEnd must be after seasonStart by at most 365 days');

  // Numeric ranges
  if (input.matchDurationMinutes < 30 || input.matchDurationMinutes > 240)
    err('matchDurationMinutes must be 30–240');
  if (input.bufferMinutes < 0 || input.bufferMinutes > 120)
    err('bufferMinutes must be 0–120');
  if (input.minRestDays < 0 || input.minRestDays > 14)
    err('minRestDays must be 0–14');
  if (input.maxConsecutiveAway !== undefined &&
      (input.maxConsecutiveAway < 1 || input.maxConsecutiveAway > 10))
    err('maxConsecutiveAway must be 1–10');

  // Format
  if (input.format !== 'single_round_robin' && input.format !== 'double_round_robin')
    err(`unsupported format: ${input.format}`);

  // SEC-19: Season-level blackout dates cap
  if ((input.blackoutDates?.length ?? 0) > 366)
    err('Too many season-level blackout dates (max 366)');

  // Blackout dates (combined total)
  const totalBlackouts = (input.blackoutDates?.length ?? 0) +
    input.venues.reduce((s, v) => s + (v.blackoutDates?.length ?? 0), 0);
  if (totalBlackouts > 365)
    err('too many blackout dates');

  // Blackout date formats
  const allBlackouts = [
    ...(input.blackoutDates ?? []),
    ...input.venues.flatMap(v => v.blackoutDates ?? []),
  ];
  for (const d of allBlackouts) {
    if (!ISO_DATE_RE.test(d)) err('dates must be ISO format YYYY-MM-DD');
  }

  // Unique team IDs
  const teamIds = new Set<string>();
  for (const t of input.teams) {
    if (teamIds.has(t.id)) err(`duplicate team id: ${t.id}`);
    teamIds.add(t.id);
  }

  // Unique venue IDs
  const venueIds = new Set<string>();
  for (const v of input.venues) {
    if (venueIds.has(v.id)) err(`duplicate venue id: ${v.id}`);
    venueIds.add(v.id);

    if (v.surfaces && v.surfaces.length > 0) {
      // Surface-aware path: validate surfaces array
      if (v.surfaces.length > 20)
        err(`venue ${v.name} has too many surfaces (max 20)`);
    } else {
      // Legacy path: validate concurrentPitches
      if (v.concurrentPitches < 1 || v.concurrentPitches > 20)
        err('concurrentPitches must be 1–20');
    }

    if (!v.availabilityWindows || v.availabilityWindows.length === 0)
      err(`venue ${v.name} has no availability windows`);
    // SEC-19: Per-venue array caps
    if (v.availabilityWindows.length > 21)
      err(`venue ${v.name} has too many availability windows (max 21)`);
    if ((v.fallbackWindows?.length ?? 0) > 21)
      err(`venue ${v.name} has too many fallback windows (max 21)`);
    if ((v.blackoutDates?.length ?? 0) > 366)
      err(`venue ${v.name} has too many blackout dates (max 366)`);
    // Validate window time formats
    for (const w of [...v.availabilityWindows, ...(v.fallbackWindows ?? [])]) {
      if (!TIME_RE.test(w.startTime) || !TIME_RE.test(w.endTime))
        err('times must be HH:MM 24-hour format');
    }
  }

  // homeVenueId references
  for (const t of input.teams) {
    if (t.homeVenueId && !venueIds.has(t.homeVenueId))
      err(`team ${t.name} homeVenueId references unknown venue ${t.homeVenueId}`);
  }

  // Soft constraints
  for (const sc of input.softConstraintPriority) {
    if (!VALID_SOFT_CONSTRAINTS.has(sc))
      err(`unknown soft constraint: ${sc}`);
  }

  // gamesPerTeam validation
  if (input.gamesPerTeam !== undefined) {
    if (input.gamesPerTeam < 1)
      err('gamesPerTeam must be at least 1');
    // SEC-19: Absolute cap to prevent excessive computation
    if (input.gamesPerTeam > 100)
      err('gamesPerTeam must be at most 100');
  }

  // Doubleheader validation
  if (input.doubleheader?.enabled && input.format !== 'double_round_robin')
    err('doubleheaders require format = double_round_robin');

  // Validate coach availability time formats and state values
  const VALID_AVAIL_STATES = new Set(['preferred', 'available', 'unavailable']);
  for (const ca of (input.coachAvailability ?? [])) {
    for (const w of (ca.weeklyWindows ?? [])) {
      if (!TIME_RE.test(w.startTime) || !TIME_RE.test(w.endTime))
        err('times must be HH:MM 24-hour format');
      if (w.state !== undefined && !VALID_AVAIL_STATES.has(w.state))
        err(`invalid availability state: ${w.state}`);
    }
  }

  // Divisions validation
  if (input.divisions && input.divisions.length > 0) {
    // DoS cap
    if (input.divisions.length > 16)
      err('divisions must contain at most 16 entries');

    // No team in two divisions
    const seenInDivision = new Map<string, string>();
    for (const div of input.divisions) {
      for (const tid of div.teamIds) {
        const prev = seenInDivision.get(tid);
        if (prev !== undefined)
          err(`team ${tid} appears in multiple divisions: ${prev} and ${div.id}`);
        seenInDivision.set(tid, div.id);
      }
    }

    // All division teamIds must be in input.teams
    for (const div of input.divisions) {
      for (const tid of div.teamIds) {
        if (!teamIds.has(tid))
          err(`division ${div.id} references unknown team ${tid}`);
      }
      if (div.enforcement !== undefined && div.enforcement !== 'soft' && div.enforcement !== 'hard')
        err(`division ${div.id} has invalid enforcement value: ${div.enforcement}`);
      if (div.gamesPerTeam !== undefined) {
        if (div.gamesPerTeam < 1)
          err(`division ${div.id} gamesPerTeam must be at least 1`);
        if (div.gamesPerTeam > 100)
          err(`division ${div.id} gamesPerTeam must be at most 100`);
      }
      if (div.format !== undefined && div.format !== 'single_round_robin' && div.format !== 'double_round_robin')
        err(`division ${div.id} has unsupported format: ${div.format}`);
    }
  }
}

// ─── §3 Step 0 — Feasibility Pre-Check ───────────────────────────────────

export function feasibilityPreCheck(input: GenerateScheduleInput): void {
  let N = input.teams.length;
  if (N % 2 === 1) N += 1;

  // BUG-12 / FW-45: For multi-division leagues, required fixtures must be summed
  // per-division using each division's own gamesPerTeam and team count. Using the
  // top-level gamesPerTeam against the full team pool inflates the requirement by
  // the division count and triggers spurious infeasibility errors.
  let requiredFixtures: number;
  if (input.divisions && input.divisions.length > 0) {
    requiredFixtures = 0;
    for (const div of input.divisions) {
      const divGpt = div.gamesPerTeam ?? input.gamesPerTeam;
      const divTeamCount = div.teamIds.length;
      if (divGpt !== undefined) {
        requiredFixtures += Math.ceil((divGpt * divTeamCount) / 2);
      } else {
        let dN = divTeamCount;
        if (dN % 2 === 1) dN += 1;
        requiredFixtures += input.format === 'single_round_robin'
          ? (dN * (dN - 1)) / 2
          : dN * (dN - 1);
      }
    }
  } else {
    requiredFixtures = input.gamesPerTeam !== undefined
      ? Math.ceil((input.gamesPerTeam * input.teams.length) / 2)
      : input.format === 'single_round_robin'
        ? (N * (N - 1)) / 2
        : N * (N - 1);
  }

  const seasonBlackouts = new Set(input.blackoutDates ?? []);
  let totalAvailableSlots = 0;

  for (const date of dateRange(input.seasonStart, input.seasonEnd)) {
    if (seasonBlackouts.has(date)) continue;
    const dow = dayOfWeek(date);
    for (const venue of input.venues) {
      const venueBlackouts = new Set(venue.blackoutDates ?? []);
      if (venueBlackouts.has(date)) continue;
      const allWindows = [
        ...(venue.availabilityWindows ?? []).map(w => ({ ...w, fallback: false })),
        ...(venue.fallbackWindows ?? []).map(w => ({ ...w, fallback: true })),
      ];
      const surfaceCount = (venue.surfaces && venue.surfaces.length > 0)
        ? venue.surfaces.length
        : venue.concurrentPitches;
      for (const window of allWindows) {
        if (window.dayOfWeek !== dow) continue;
        const windowDuration =
          timeToMinutes(window.endTime) - timeToMinutes(window.startTime);
        const slotSize = input.matchDurationMinutes + input.bufferMinutes;
        if (slotSize <= 0) continue;
        const slotsInWindow = Math.floor(windowDuration / slotSize);
        totalAvailableSlots += slotsInWindow * surfaceCount;
      }
    }
  }

  if (totalAvailableSlots < requiredFixtures * 0.5) {
    throw new HttpsError(
      'invalid-argument',
      `Season configuration is infeasible: only ${totalAvailableSlots} slots available ` +
      `for ${requiredFixtures} required fixtures. Extend the season window, add venues, ` +
      `or reduce team count.`
    );
  }
}

// ─── §A — expandVenueSurfaces ─────────────────────────────────────────────

/**
 * Normalizes venue input to a list of named surfaces.
 * If surfaces are explicitly defined, returns them directly.
 * Otherwise synthesizes surfaces from concurrentPitches for backward compat.
 */
export function expandVenueSurfaces(venue: ScheduleVenueInput): ScheduleSurfaceInput[] {
  if (venue.surfaces && venue.surfaces.length > 0) return venue.surfaces;
  const count = venue.concurrentPitches ?? 1;
  return Array.from({ length: count }, (_, i) => ({
    id: `_pitch_${i}`,
    name: `Pitch ${i + 1}`,
  }));
}

// ─── §3 Step 1 — Slot Generation ─────────────────────────────────────────

export function generateSlots(input: GenerateScheduleInput): Slot[] {
  const slots: Slot[] = [];
  const seasonBlackouts = new Set(input.blackoutDates ?? []);
  const slotSize = input.matchDurationMinutes + input.bufferMinutes;

  for (const date of dateRange(input.seasonStart, input.seasonEnd)) {
    if (seasonBlackouts.has(date)) continue;
    const dow = dayOfWeek(date);

    for (const venue of input.venues) {
      const venueBlackouts = new Set(venue.blackoutDates ?? []);
      if (venueBlackouts.has(date)) continue;

      const useSurfaces = venue.surfaces && venue.surfaces.length > 0;

      if (useSurfaces) {
        // ── Surface-aware path: each surface is its own bookable unit ──────────
        const surfaces = expandVenueSurfaces(venue);

        for (const surface of surfaces) {
          // Surface inherits venue blackouts; add any surface-specific blackouts
          const surfaceBlackouts = new Set([
            ...Array.from(venueBlackouts),
            ...(surface.blackoutDates ?? []),
          ]);
          if (surfaceBlackouts.has(date)) continue;

          // Use surface-specific availability windows if present, otherwise venue's
          const primaryWindows = surface.availabilityWindows ?? venue.availabilityWindows ?? [];
          // Fallback windows are venue-level only (surfaces don't have fallback windows)
          const fallbackWindows = venue.fallbackWindows ?? [];

          // Primary windows
          for (const window of primaryWindows) {
            if (window.dayOfWeek !== dow) continue;
            let startMins = timeToMinutes(window.startTime);
            const endMins = timeToMinutes(window.endTime);
            while (startMins + input.matchDurationMinutes <= endMins) {
              const startTime = minutesToTime(startMins);
              const endTime = minutesToTime(startMins + input.matchDurationMinutes);
              slots.push({
                date,
                venueId: venue.id,
                venueName: venue.name,
                surfaceId: surface.id,
                surfaceName: surface.name,
                startTime,
                endTime,
                concurrentCapacity: 1,
                isFallback: false,
                key: `${date}|${venue.id}|${surface.id}|${startTime}`,
              });
              startMins += slotSize;
            }
          }

          // Fallback windows
          for (const window of fallbackWindows) {
            if (window.dayOfWeek !== dow) continue;
            let startMins = timeToMinutes(window.startTime);
            const endMins = timeToMinutes(window.endTime);
            while (startMins + input.matchDurationMinutes <= endMins) {
              const startTime = minutesToTime(startMins);
              const endTime = minutesToTime(startMins + input.matchDurationMinutes);
              slots.push({
                date,
                venueId: venue.id,
                venueName: venue.name,
                surfaceId: surface.id,
                surfaceName: surface.name,
                startTime,
                endTime,
                concurrentCapacity: 1,
                isFallback: true,
                key: `${date}|${venue.id}|${surface.id}|${startTime}`,
              });
              startMins += slotSize;
            }
          }
        }
      } else {
        // ── Legacy path: concurrentPitches capacity on a single slot key ──────

        // Primary windows first
        for (const window of (venue.availabilityWindows ?? [])) {
          if (window.dayOfWeek !== dow) continue;
          let startMins = timeToMinutes(window.startTime);
          const endMins = timeToMinutes(window.endTime);
          while (startMins + input.matchDurationMinutes <= endMins) {
            const startTime = minutesToTime(startMins);
            const endTime = minutesToTime(startMins + input.matchDurationMinutes);
            slots.push({
              date,
              venueId: venue.id,
              venueName: venue.name,
              startTime,
              endTime,
              concurrentCapacity: venue.concurrentPitches,
              isFallback: false,
              key: `${date}|${venue.id}|${startTime}`,
            });
            startMins += slotSize;
          }
        }

        // Fallback windows
        for (const window of (venue.fallbackWindows ?? [])) {
          if (window.dayOfWeek !== dow) continue;
          let startMins = timeToMinutes(window.startTime);
          const endMins = timeToMinutes(window.endTime);
          while (startMins + input.matchDurationMinutes <= endMins) {
            const startTime = minutesToTime(startMins);
            const endTime = minutesToTime(startMins + input.matchDurationMinutes);
            slots.push({
              date,
              venueId: venue.id,
              venueName: venue.name,
              startTime,
              endTime,
              concurrentCapacity: venue.concurrentPitches,
              isFallback: true,
              key: `${date}|${venue.id}|${startTime}`,
            });
            startMins += slotSize;
          }
        }
      }
    }
  }

  // Sort: primary before fallback; within same type sort by prefer_weekends
  const preferWeekends = input.softConstraintPriority.includes('prefer_weekends');
  slots.sort((a, b) => {
    // Primary before fallback
    if (a.isFallback !== b.isFallback) return a.isFallback ? 1 : -1;
    if (preferWeekends) {
      const aWd = isWeekday(a.date);
      const bWd = isWeekday(b.date);
      if (aWd !== bWd) return aWd ? 1 : -1;
    }
    // Chronological
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.startTime < b.startTime ? -1 : 1;
  });

  return slots;
}

// ─── §4 Round-Robin Formula ───────────────────────────────────────────────

/**
 * Truncates a fixture list to `targetTotal` by preferentially removing fixtures
 * from the most-repeated matchup pairs (latest occurrence first).
 * Guarantees matchup imbalance of at most ±1 across all pairs.
 */
function truncateEvenly(fixtures: Pairing[], targetTotal: number): Pairing[] {
  if (fixtures.length <= targetTotal) return fixtures;

  // Count occurrences of each pair
  const pairCount = new Map<string, number>();
  for (const f of fixtures) {
    const key = [f.homeTeamId, f.awayTeamId].sort().join('|');
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }

  // Build removal candidates: prefer removing from most-repeated pairs,
  // among ties prefer removing from higher index (later in the list)
  const candidates = fixtures
    .map((f, idx) => {
      const key = [f.homeTeamId, f.awayTeamId].sort().join('|');
      return { idx, count: pairCount.get(key) ?? 0 };
    })
    .sort((a, b) => b.count - a.count || b.idx - a.idx);

  const toRemove = fixtures.length - targetTotal;
  const removeSet = new Set(candidates.slice(0, toRemove).map(c => c.idx));

  return fixtures.filter((_, idx) => !removeSet.has(idx));
}

/**
 * Generate all pairings using the circle method.
 * Handles odd N (adds BYE), double round-robin, and partial gamesPerTeam.
 */
export function generatePairings(input: GenerateScheduleInput): Pairing[] {
  let teams = [...input.teams];
  const hasBye = teams.length % 2 === 1;
  if (hasBye) {
    teams = [...teams, { id: 'BYE', name: 'BYE' }];
  }
  const N = teams.length;

  const allPairings: Pairing[] = [];
  let pairingIndex = 0;

  // Circle method: fix teams[0], rotate the rest
  const rotatable = teams.slice(1);

  for (let round = 0; round < N - 1; round++) {
    // Build this round's pairs using circle method rotation
    // teams[0] is fixed; the rest rotate
    const roundTeams = [teams[0], ...rotatable.slice(round).concat(rotatable.slice(0, round))];

    for (let i = 0; i < N / 2; i++) {
      const home = roundTeams[i];
      const away = roundTeams[N - 1 - i];

      // Skip bye pairings
      if (home.id === 'BYE' || away.id === 'BYE') {
        pairingIndex++;
        continue;
      }

      // Home/away: fixed team alternates; others follow circle method
      const isEvenRound = round % 2 === 0;
      const fixedIsHome = i === 0 && isEvenRound;
      let homeTeam = home;
      let awayTeam = away;

      if (i === 0) {
        homeTeam = fixedIsHome ? home : away;
        awayTeam = fixedIsHome ? away : home;
      }

      allPairings.push({
        homeTeamId:   homeTeam.id,
        homeTeamName: homeTeam.name,
        awayTeamId:   awayTeam.id,
        awayTeamName: awayTeam.name,
        round:        round + 1,
        pairingIndex: pairingIndex++,
      });
    }

  }

  // Multi-pass: cycle through round-robin passes until gamesPerTeam is reached.
  // When gamesPerTeam is not provided, fall back to format-based 1 or 2 passes (backward compat).
  if (input.gamesPerTeam !== undefined) {
    const realN = input.teams.length; // actual team count, excluding BYE
    const targetTotal = Math.ceil((input.gamesPerTeam * realN) / 2);
    const multiPass: Pairing[] = [];
    let passIndex = 0;
    while (multiPass.length < targetTotal) {
      for (const p of allPairings) {
        if (multiPass.length >= targetTotal) break;
        // Alternate home/away each pass for balance
        if (passIndex % 2 === 0) {
          multiPass.push({ ...p, pairingIndex: multiPass.length });
        } else {
          multiPass.push({
            homeTeamId:   p.awayTeamId,
            homeTeamName: p.awayTeamName,
            awayTeamId:   p.homeTeamId,
            awayTeamName: p.homeTeamName,
            round:        p.round + passIndex * (N - 1),
            pairingIndex: multiPass.length,
          });
        }
      }
      passIndex++;
    }
    return truncateEvenly(multiPass, targetTotal);
  } else {
    // Backward compat: format-driven 1 or 2 passes
    let result = allPairings;
    if (input.format === 'double_round_robin') {
      const secondLeg: Pairing[] = allPairings.map((p, i) => ({
        homeTeamId:   p.awayTeamId,
        homeTeamName: p.awayTeamName,
        awayTeamId:   p.homeTeamId,
        awayTeamName: p.homeTeamName,
        round:        p.round + (N - 1),
        pairingIndex: allPairings.length + i,
      }));
      result = [...allPairings, ...secondLeg];
    }
    return result;
  }
}

/**
 * Generate pairings for a specific division with its own team subset, format,
 * gamesPerTeam, and matchDuration overrides.
 */
function generateDivisionPairings(
  division: DivisionInput,
  input: GenerateScheduleInput,
): Pairing[] {
  const divisionTeams = input.teams.filter(t => division.teamIds.includes(t.id));
  const divInput: GenerateScheduleInput = {
    ...input,
    teams: divisionTeams,
    format: division.format,
    gamesPerTeam: division.gamesPerTeam ?? input.gamesPerTeam,
    matchDurationMinutes: division.matchDurationMinutes ?? input.matchDurationMinutes,
  };
  return generatePairings(divInput);
}

// ─── §3 Step 4 — Soft Constraint Scoring ─────────────────────────────────

function timesOverlap(
  slotStart: string, slotEnd: string,
  eventStart: string, eventEnd: string
): boolean {
  return timeToMinutes(slotStart) < timeToMinutes(eventEnd) &&
         timeToMinutes(slotEnd) > timeToMinutes(eventStart);
}

/**
 * Resolve the effective AvailabilityState for a weekly window entry.
 * When `state` is present it takes precedence; otherwise fall back to
 * the legacy `available` boolean (true → 'available', false → 'unavailable').
 */
function resolveWindowState(w: CoachAvailabilityInput['weeklyWindows'][number]): AvailabilityState {
  if (w.state !== undefined) return w.state;
  // Legacy boolean fallback
  return w.available === true ? 'available' : 'unavailable';
}

/**
 * Returns the penalty contribution for a single coach/team at a given slot.
 *   preferred   → -1  (bonus: scheduler actively favors this slot)
 *   available   →  0  (neutral)
 *   unavailable → +1  (penalty: deprioritize)
 *
 * Date overrides always resolve to 'unavailable' (+1).
 * No window defined for the day resolves to 'unavailable' (+1).
 */
function coachPenaltyForTeam(
  slot: Slot,
  ca: CoachAvailabilityInput,
): number {
  const slotDow = dayOfWeek(slot.date);

  // Date overrides take priority — unavailable on the full date range
  for (const ov of (ca.dateOverrides ?? [])) {
    if (slot.date >= ov.start && slot.date <= ov.end) {
      return 1; // unavailable
    }
  }

  // Weekly windows
  const matchingWindows = (ca.weeklyWindows ?? []).filter(w => w.dayOfWeek === slotDow);
  if (matchingWindows.length === 0) {
    // No window defined for this day — treat as unavailable
    return 1;
  }

  // Find a window that covers the slot time; use the best state found.
  // Priority order: preferred (-1) > available (0) > unavailable (+1).
  const slotStart = timeToMinutes(slot.startTime);
  const slotEnd   = timeToMinutes(slot.endTime);
  // Use a numeric score to track best: -1 = preferred, 0 = available, 1 = unavailable.
  // Start at +2 (sentinel = "no covering window found").
  let bestScore = 2;

  for (const w of matchingWindows) {
    if (timeToMinutes(w.startTime) <= slotStart && timeToMinutes(w.endTime) >= slotEnd) {
      const state = resolveWindowState(w);
      const score = state === 'preferred' ? -1 : state === 'available' ? 0 : 1;
      if (score < bestScore) {
        bestScore = score;
        if (bestScore === -1) break; // can't get better
      }
    }
  }

  if (bestScore === 2) {
    // No window covered the slot time — treat as unavailable
    return 1;
  }

  return bestScore; // -1, 0, or 1
}

function computeCoachAvailabilityPenalty(
  slot: Slot,
  pairing: Pairing,
  coachAvailability: CoachAvailabilityInput[] | undefined,
): number {
  if (!coachAvailability) return 0;
  let penalty = 0;
  const teamIds = [pairing.homeTeamId, pairing.awayTeamId];

  for (const teamId of teamIds) {
    const ca = coachAvailability.find(c => c.teamId === teamId);
    if (!ca) continue;
    penalty += coachPenaltyForTeam(slot, ca);
  }

  return penalty;
}

/**
 * Hard-enforcement check: returns true if either coach is explicitly marked
 * unavailable at the given slot via a date override or a weekly window entry
 * that resolves to 'unavailable'.
 *
 * Key difference from coachPenaltyForTeam: an empty weeklyWindows array means
 * "no preference specified" and does NOT constitute a hard block.  This avoids
 * false positives when a coach submits date-override-only availability (no
 * weekly grid entries) — without this guard, every non-override slot would
 * incorrectly be treated as a hard blackout.
 */
export function isCoachUnavailable(
  slot: Slot,
  pairing: Pairing,
  coachAvailability: CoachAvailabilityInput[] | undefined,
): boolean {
  if (!coachAvailability) return false;
  const teamIds = [pairing.homeTeamId, pairing.awayTeamId];

  for (const teamId of teamIds) {
    const ca = coachAvailability.find(c => c.teamId === teamId);
    if (!ca) continue;

    // 1. Date overrides take absolute priority.
    const hasDateBlock = (ca.dateOverrides ?? []).some(
      ov => slot.date >= ov.start && slot.date <= ov.end,
    );
    if (hasDateBlock) return true;

    // 2. Weekly windows — only consult if the coach submitted any weekly windows at all.
    //    If weeklyWindows is empty, the coach submitted date-override-only availability
    //    and we treat non-override slots as "no preference" (not a hard block).
    const allWeeklyWindows = ca.weeklyWindows ?? [];
    if (allWeeklyWindows.length === 0) continue;

    // Coach has a weekly pattern. A day not listed = explicitly not available.
    const slotDow = dayOfWeek(slot.date);
    const matchingWindows = allWeeklyWindows.filter(w => w.dayOfWeek === slotDow);
    if (matchingWindows.length === 0) return true; // day not in coach's weekly pattern

    const slotStart = timeToMinutes(slot.startTime);
    const slotEnd   = timeToMinutes(slot.endTime);
    const isExplicitlyUnavailable = matchingWindows.some(w => {
      if (timeToMinutes(w.startTime) > slotStart || timeToMinutes(w.endTime) < slotEnd) return false;
      return resolveWindowState(w) === 'unavailable';
    });
    if (isExplicitlyUnavailable) return true;
  }

  return false;
}

export function scorePenalty(
  slot: Slot,
  pairing: Pairing,
  homeState: TeamState,
  awayState: TeamState,
  input: GenerateScheduleInput,
  homeTeam: ScheduleTeamInput,
): number {
  let penalty = 0;
  const priorityCount = input.softConstraintPriority.length;

  for (let i = 0; i < input.softConstraintPriority.length; i++) {
    const constraintId = input.softConstraintPriority[i];
    let weight = priorityCount - i + 1;

    // Special case: balance_home_away gets double weight in strict mode (§7.3)
    if (input.homeAwayMode === 'strict' && constraintId === 'balance_home_away') {
      weight = weight * 2;
    }

    switch (constraintId) {
      case 'prefer_weekends':
        if (isWeekday(slot.date)) penalty += weight;
        break;

      case 'balance_home_away': {
        const imbalance = Math.abs(homeState.homeCount - homeState.awayCount);
        if (imbalance > 1) penalty += weight * imbalance;
        break;
      }

      case 'minimise_doubleheaders':
        if (homeState.gamesByDate.has(slot.date) || awayState.gamesByDate.has(slot.date)) {
          penalty += weight * 10;
        }
        break;

      case 'respect_coach_availability': {
        const coachPenalty = computeCoachAvailabilityPenalty(slot, pairing, input.coachAvailability);
        penalty += weight * coachPenalty;
        break;
      }

      case 'min_rest_days': {
        const softRestDays = input.minRestDays + 1;
        if (homeState.lastGameDate !== null) {
          const gap = daysBetween(homeState.lastGameDate, slot.date);
          if (gap < softRestDays) penalty += weight * (softRestDays - gap);
        }
        if (awayState.lastGameDate !== null) {
          const gap = daysBetween(awayState.lastGameDate, slot.date);
          if (gap < softRestDays) penalty += weight * (softRestDays - gap);
        }
        break;
      }

      case 'max_consecutive_away': {
        const maxAway = input.maxConsecutiveAway ?? 3;
        if (awayState.consecutiveAway >= maxAway) {
          penalty += weight * awayState.consecutiveAway;
        }
        break;
      }

      case 'avoid_practice_conflicts': {
        for (const pe of (input.practiceEvents ?? [])) {
          if (pe.teamId !== pairing.homeTeamId && pe.teamId !== pairing.awayTeamId) continue;
          if (slot.date !== pe.date) continue;
          if (timesOverlap(slot.startTime, slot.endTime, pe.startTime, pe.endTime)) {
            if (!pe.reschedulable) {
              penalty += weight;
            }
            // reschedulable: no penalty now; soft conflict added post-assignment
          }
        }
        break;
      }
    }
  }

  // Home venue mismatch penalty (Amendment 2)
  if (homeTeam.homeVenueId && slot.venueId !== homeTeam.homeVenueId) {
    // Penalty = weight of lowest-priority constraint (i.e. 1 × 1 if none, else last weight)
    const lowestWeight = priorityCount > 0 ? 1 : 1;
    penalty += lowestWeight;
  }

  return penalty;
}

// ─── Surface time window overlap detection ────────────────────────────────

/**
 * Map key: `${date}|${venueId}|${surfaceId}` → list of booked {start, end} windows
 * (minutes since midnight).
 */
type SurfaceTimeWindowsMap = Map<string, Array<{ start: number; end: number }>>;

/** Returns true if [aStart, aEnd) overlaps [bStart, bEnd). */
function windowsOverlap(
  aStart: number, aEnd: number,
  bStart: number, bEnd: number,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Check whether a slot is blocked by an already-booked time window on the same surface.
 * Only applies to surface-aware slots (those with a surfaceId).
 */
function isSurfaceBlocked(
  slot: Slot,
  matchDurationMinutes: number,
  surfaceTimeWindows: SurfaceTimeWindowsMap,
): boolean {
  if (!slot.surfaceId) return false;

  const mapKey = `${slot.date}|${slot.venueId}|${slot.surfaceId}`;
  const existing = surfaceTimeWindows.get(mapKey);
  if (!existing || existing.length === 0) return false;

  const slotStart = timeToMinutes(slot.startTime);
  const slotEnd = slotStart + matchDurationMinutes;

  for (const w of existing) {
    if (windowsOverlap(slotStart, slotEnd, w.start, w.end)) return true;
  }
  return false;
}

/**
 * Record a booked time window on a surface after assignment.
 */
function recordSurfaceWindow(
  slot: Slot,
  matchDurationMinutes: number,
  surfaceTimeWindows: SurfaceTimeWindowsMap,
): void {
  if (!slot.surfaceId) return;

  const mapKey = `${slot.date}|${slot.venueId}|${slot.surfaceId}`;
  if (!surfaceTimeWindows.has(mapKey)) {
    surfaceTimeWindows.set(mapKey, []);
  }
  const start = timeToMinutes(slot.startTime);
  surfaceTimeWindows.get(mapKey)!.push({ start, end: start + matchDurationMinutes });
}

// ─── §3 Step 3 — Assignment Loop ─────────────────────────────────────────

/**
 * Context passed when running assignment for a single division.
 * Carries division-specific constraints and shared mutable state maps.
 */
interface DivisionAssignmentContext {
  divisionId: string;
  matchDurationMinutes: number;
  /** If non-empty, only slots for these (venueId, surfaceId) pairs are eligible (required preference). */
  requiredSurfaces: Array<{ venueId: string; surfaceId: string }> | null;
  /** If non-empty, slots for these surfaces get a soft bonus (preferred preference). */
  preferredSurfaces: Array<{ venueId: string; surfaceId: string }> | null;
  /** Shared across all divisions — must not be reset between divisions. */
  sharedSlotUsage: Map<string, number>;
  /** Shared across all divisions — must not be reset between divisions. */
  sharedSurfaceTimeWindows: SurfaceTimeWindowsMap;
  /**
   * Per-division coach availability enforcement mode.
   * 'hard' → isCoachUnavailable() slots are skipped entirely (hard blackout).
   * 'soft' (default) → scoring only, no slot is excluded.
   */
  coachEnforcement: 'soft' | 'hard';
}

export function assignFixtures(
  pairings: Pairing[],
  slots: Slot[],
  input: GenerateScheduleInput,
  divisionCtx?: DivisionAssignmentContext,
): AssignmentResult {
  const assigned: AssignmentResult['assigned'] = [];
  const unassigned: AssignmentResult['unassigned'] = [];

  // Per-team state — scoped to the teams in this invocation
  const teamIds = new Set(pairings.flatMap(p => [p.homeTeamId, p.awayTeamId]));
  const teamState = new Map<string, TeamState>();
  for (const t of input.teams) {
    if (teamIds.has(t.id)) {
      teamState.set(t.id, {
        lastGameDate:    null,
        consecutiveAway: 0,
        homeCount:       0,
        awayCount:       0,
        gamesByDate:     new Set(),
        gameDates:       [],
      });
    }
  }

  // Use shared slot usage map if provided (division path), otherwise create a local one
  const slotUsage: Map<string, number> = divisionCtx
    ? divisionCtx.sharedSlotUsage
    : (() => {
        const m = new Map<string, number>();
        for (const s of slots) m.set(s.key, 0);
        return m;
      })();

  // Ensure all slot keys exist in slotUsage (needed when slots are passed from division path)
  if (!divisionCtx) {
    // Already initialized above
  } else {
    for (const s of slots) {
      if (!slotUsage.has(s.key)) slotUsage.set(s.key, 0);
    }
  }

  // Surface time windows map (shared or local)
  const surfaceTimeWindows: SurfaceTimeWindowsMap = divisionCtx
    ? divisionCtx.sharedSurfaceTimeWindows
    : new Map();

  // Match duration for this assignment pass
  const matchDuration = divisionCtx?.matchDurationMinutes ?? input.matchDurationMinutes;

  // Build required/preferred surface sets for fast lookup
  const requiredSet = divisionCtx?.requiredSurfaces
    ? new Set(divisionCtx.requiredSurfaces.map(s => `${s.venueId}|${s.surfaceId}`))
    : null;
  const preferredSet = divisionCtx?.preferredSurfaces
    ? new Set(divisionCtx.preferredSurfaces.map(s => `${s.venueId}|${s.surfaceId}`))
    : null;

  for (const pairing of pairings) {
    const home = teamState.get(pairing.homeTeamId)!;
    const away = teamState.get(pairing.awayTeamId)!;
    const homeTeam = input.teams.find(t => t.id === pairing.homeTeamId)!;

    let bestSlot: Slot | null = null;
    let bestPenalty = Infinity;

    for (const slot of slots) {
      // ── Division surface preference filter ──────────────────────────────

      // Required surface: skip slots not on required surfaces
      if (requiredSet !== null && slot.surfaceId !== undefined) {
        const surfaceKey = `${slot.venueId}|${slot.surfaceId}`;
        if (!requiredSet.has(surfaceKey)) continue;
      }

      // ── Hard constraint checks ──────────────────────────────────────────

      // 1. Venue capacity (legacy path) / surface capacity (surface-aware path)
      const usage = slotUsage.get(slot.key) ?? 0;
      if (usage >= slot.concurrentCapacity) continue;

      // 2. Duration-aware overlap detection for surface-aware slots
      if (slot.surfaceId !== undefined &&
          isSurfaceBlocked(slot, matchDuration, surfaceTimeWindows)) continue;

      // 3. No same-day double-booking
      if (home.gamesByDate.has(slot.date)) continue;
      if (away.gamesByDate.has(slot.date)) continue;

      // 4. Minimum rest days (hard floor)
      if (home.lastGameDate !== null) {
        if (daysBetween(home.lastGameDate, slot.date) < input.minRestDays) continue;
      }
      if (away.lastGameDate !== null) {
        if (daysBetween(away.lastGameDate, slot.date) < input.minRestDays) continue;
      }

      // 5. Home venue hard enforcement
      if (input.homeAwayMode === 'strict' && input.homeVenueEnforcement === 'hard') {
        if (homeTeam.homeVenueId && slot.venueId !== homeTeam.homeVenueId) continue;
      }

      // 6. Coach availability hard enforcement (per-division)
      if (divisionCtx?.coachEnforcement === 'hard') {
        if (isCoachUnavailable(slot, pairing, input.coachAvailability)) continue;
      }

      // ── Soft constraint scoring ─────────────────────────────────────────
      let penalty = scorePenalty(slot, pairing, home, away, input, homeTeam);

      // Preferred surface bonus: non-preferred slots get a soft penalty
      if (preferredSet !== null && slot.surfaceId !== undefined) {
        const surfaceKey = `${slot.venueId}|${slot.surfaceId}`;
        if (!preferredSet.has(surfaceKey)) {
          penalty += 5; // soft penalty for using a non-preferred surface
        }
      }

      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestSlot = slot;
      }
    }

    if (bestSlot !== null) {
      // Check for practice conflicts that need post-assignment soft conflict recording
      const practiceConflicts: Array<{ teamId: string; teamName: string }> = [];
      for (const pe of (input.practiceEvents ?? [])) {
        if (pe.teamId !== pairing.homeTeamId && pe.teamId !== pairing.awayTeamId) continue;
        if (bestSlot.date !== pe.date) continue;
        if (timesOverlap(bestSlot.startTime, bestSlot.endTime, pe.startTime, pe.endTime)) {
          if (pe.reschedulable) {
            const team = input.teams.find(t => t.id === pe.teamId);
            if (team) practiceConflicts.push({ teamId: team.id, teamName: team.name });
          }
        }
      }

      assigned.push({ pairing, slot: bestSlot, penalty: bestPenalty, practiceConflicts });
      slotUsage.set(bestSlot.key, (slotUsage.get(bestSlot.key) ?? 0) + 1);

      // Record surface time window after assignment (duration-aware)
      recordSurfaceWindow(bestSlot, matchDuration, surfaceTimeWindows);

      // Update home team state
      home.lastGameDate = bestSlot.date;
      home.homeCount++;
      home.consecutiveAway = 0; // reset consecutive away when playing home
      home.gamesByDate.add(bestSlot.date);
      home.gameDates.push(bestSlot.date);

      // Update away team state
      away.lastGameDate = bestSlot.date;
      away.consecutiveAway++;
      away.awayCount++;
      away.gamesByDate.add(bestSlot.date);
      away.gameDates.push(bestSlot.date);
    } else {
      // Diagnose reason
      const reason = explainNoSlot(pairing, slots, teamState, input, homeTeam);
      unassigned.push({ pairing, reason });
    }
  }

  return { assigned, unassigned };
}

/** Determine the most likely reason a pairing could not be assigned. */
function explainNoSlot(
  pairing: Pairing,
  slots: Slot[],
  teamState: Map<string, TeamState>,
  input: GenerateScheduleInput,
  homeTeam: ScheduleTeamInput,
): string {
  const home = teamState.get(pairing.homeTeamId)!;
  const away = teamState.get(pairing.awayTeamId)!;

  // Check if hard venue enforcement is the issue
  if (input.homeAwayMode === 'strict' && input.homeVenueEnforcement === 'hard' && homeTeam.homeVenueId) {
    const homeVenueSlots = slots.filter(s => s.venueId === homeTeam.homeVenueId);
    if (homeVenueSlots.length === 0) return 'HOME_VENUE_NO_SLOT';
  }

  // Check if rest days are the issue
  for (const slot of slots) {
    if (home.lastGameDate !== null &&
        daysBetween(home.lastGameDate, slot.date) < input.minRestDays) continue;
    if (away.lastGameDate !== null &&
        daysBetween(away.lastGameDate, slot.date) < input.minRestDays) continue;
    // At least one slot passes rest check; capacity must be exhausted
    return 'CAPACITY_EXHAUSTED';
  }

  // All slots fail rest check
  if ((home.lastGameDate !== null || away.lastGameDate !== null) &&
      input.minRestDays > 0) {
    return 'REST_CONFLICT';
  }

  return 'NO_SLOT_IN_SEASON';
}

// ─── §D — Division-aware orchestration ───────────────────────────────────

/**
 * Run the schedule algorithm with division-aware orchestration.
 *
 * When input.divisions is present and non-empty:
 * - Validates no team appears in two divisions
 * - Generates all slots once (shared pool)
 * - Initializes shared slotUsage and surfaceTimeWindows maps
 * - Runs per-division pairing generation and assignment
 * - Stamps each fixture with divisionId
 * - Returns merged fixtures + divisionResults
 *
 * When input.divisions is absent, falls back to the existing single-pool path.
 */
export function runScheduleAlgorithm(
  input: GenerateScheduleInput,
  seed: number,
): ScheduleAlgorithmOutput {
  const hasDivisions = input.divisions && input.divisions.length > 0;

  if (!hasDivisions) {
    // ── Single-pool path ─────────────────────────────────────────────────
    const slots = generateSlots(input);
    const rawPairings = generatePairings(input);
    // Shuffle within each round for variety, then sort by round so same-round
    // non-conflicting pairs are processed adjacently. This prevents the greedy
    // "earliest slot" pass from assigning future-round games that lock in later
    // lastGameDate values, which would then block backfilling into earlier slots.
    const shuffled = shufflePairings(rawPairings, seed);
    const byRound = [...shuffled].sort((a, b) => a.round - b.round);
    const assignmentResult = assignFixtures(byRound, slots, input);
    return buildOutput(assignmentResult, input);
  }

  // ── Division-aware path ──────────────────────────────────────────────
  const divisions = input.divisions!;

  // Generate all slots once (shared pool)
  const allSlots = generateSlots(input);

  // Shared state across division iterations
  const sharedSlotUsage = new Map<string, number>();
  for (const s of allSlots) {
    if (!sharedSlotUsage.has(s.key)) sharedSlotUsage.set(s.key, 0);
  }
  const sharedSurfaceTimeWindows: SurfaceTimeWindowsMap = new Map();

  const allAssigned: Array<{ pairing: Pairing; slot: Slot; penalty: number; practiceConflicts: Array<{ teamId: string; teamName: string }>; divisionId: string }> = [];
  const allUnassigned: Array<{ pairing: Pairing; reason: string }> = [];
  const divisionResults: DivisionScheduleResult[] = [];

  for (const division of divisions) {
    // Per-division seed for deterministic but distinct ordering
    const divSeed = fnv32a(input.leagueId + '|' + division.id + '|' + input.seasonStart);
    const matchDuration = division.matchDurationMinutes ?? input.matchDurationMinutes;

    // Build required/preferred surface lists
    let requiredSurfaces: Array<{ venueId: string; surfaceId: string }> | null = null;
    let preferredSurfaces: Array<{ venueId: string; surfaceId: string }> | null = null;

    if (division.surfacePreferences && division.surfacePreferences.length > 0) {
      const required = division.surfacePreferences.filter(p => p.preference === 'required');
      const preferred = division.surfacePreferences.filter(p => p.preference === 'preferred');
      if (required.length > 0) {
        requiredSurfaces = required.map(p => ({ venueId: p.venueId, surfaceId: p.surfaceId }));
      }
      if (preferred.length > 0) {
        preferredSurfaces = preferred.map(p => ({ venueId: p.venueId, surfaceId: p.surfaceId }));
      }
    }

    const divCtx: DivisionAssignmentContext = {
      divisionId: division.id,
      matchDurationMinutes: matchDuration,
      requiredSurfaces,
      preferredSurfaces,
      sharedSlotUsage,
      sharedSurfaceTimeWindows,
      coachEnforcement: division.enforcement ?? 'soft',
    };

    // Generate pairings for this division's teams
    const rawPairings = generateDivisionPairings(division, input);
    const shuffled = shufflePairings(rawPairings, divSeed);
    // Sort by round so same-round non-conflicting pairs pack onto the same day
    const byRound = [...shuffled].sort((a, b) => a.round - b.round);

    // Filter slots for this division (required surface filter applied inside assignFixtures,
    // but we also need to pass slots that match the division's match duration window —
    // for surface-aware slots the slot endTime may differ from matchDuration, but slots
    // are generated with the top-level matchDurationMinutes; overlap detection handles the rest)
    const assignmentResult = assignFixtures(byRound, allSlots, input, divCtx);

    // Stamp fixtures with divisionId
    for (const a of assignmentResult.assigned) {
      allAssigned.push({ ...a, divisionId: division.id });
    }
    for (const u of assignmentResult.unassigned) {
      allUnassigned.push(u);
    }

    // Build DivisionScheduleResult
    const divFixtures: GeneratedFixture[] = assignmentResult.assigned.map(({ pairing, slot }) => ({
      round:          pairing.round,
      homeTeamId:     pairing.homeTeamId,
      homeTeamName:   pairing.homeTeamName,
      awayTeamId:     pairing.awayTeamId,
      awayTeamName:   pairing.awayTeamName,
      date:           slot.date,
      startTime:      slot.startTime,
      endTime:        slot.endTime,
      venueId:        slot.venueId,
      venueName:      slot.venueName,
      ...(slot.surfaceId ? { fieldId: slot.surfaceId, fieldName: slot.surfaceName } : {}),
      isDoubleheader: false,
      isFallbackSlot: slot.isFallback,
      divisionId:     division.id,
    }));

    divisionResults.push({
      divisionId:      division.id,
      divisionName:    division.name,
      fixtures:        divFixtures,
      unassignedCount: assignmentResult.unassigned.length,
    });
  }

  // Build merged output from all divisions
  const mergedAssignmentResult: AssignmentResult = {
    assigned: allAssigned.map(({ pairing, slot, penalty, practiceConflicts }) => ({
      pairing, slot, penalty, practiceConflicts,
    })),
    unassigned: allUnassigned,
  };

  // Build a teamId → divisionId map so buildOutput can partition balance trim
  // and the UNEQUAL_GAME_COUNTS warning per division (BUG-14 / FW-46), and stamp
  // divisionId onto each fixture at construction time (safe across balance trim).
  const teamDivisionMap = new Map<string, string>();
  for (const div of divisions) {
    for (const tid of div.teamIds) teamDivisionMap.set(tid, div.id);
  }

  const output = buildOutput(mergedAssignmentResult, input, teamDivisionMap);

  output.divisionResults = divisionResults;

  return output;
}

// ─── §2 Output Assembly ───────────────────────────────────────────────────

export function buildOutput(
  assignmentResult: AssignmentResult,
  input: GenerateScheduleInput,
  /**
   * BUG-14 / FW-46: Optional map from teamId → divisionId. When present, balance
   * trim and the UNEQUAL_GAME_COUNTS warning operate per-division instead of
   * across the merged team pool. Required for multi-division seasons where
   * divisions may have different gamesPerTeam values.
   */
  teamDivisionMap?: Map<string, string>,
): ScheduleAlgorithmOutput {
  const { assigned, unassigned } = assignmentResult;

  // Build fixture list
  let fixtures: GeneratedFixture[] = assigned.map(({ pairing, slot }) => ({
    round:           pairing.round,
    homeTeamId:      pairing.homeTeamId,
    homeTeamName:    pairing.homeTeamName,
    awayTeamId:      pairing.awayTeamId,
    awayTeamName:    pairing.awayTeamName,
    date:            slot.date,
    startTime:       slot.startTime,
    endTime:         slot.endTime,
    venueId:         slot.venueId,
    venueName:       slot.venueName,
    ...(slot.surfaceId ? { fieldId: slot.surfaceId, fieldName: slot.surfaceName } : {}),
    isDoubleheader:  false,
    isFallbackSlot:  slot.isFallback,
    ...(teamDivisionMap ? { divisionId: teamDivisionMap.get(pairing.homeTeamId) } : {}),
  }));

  // Balance game counts across teams (relevant for odd N with BYE, or short seasons).
  // If some pairings are unassigned the result may be skewed: one team appears more
  // often in early rounds than others. Drop the latest-round game(s) from
  // over-represented teams until all teams have equal game counts.
  // Balance game counts: iterate in reverse (latest rounds first) and drop a
  // game only when doing so strictly reduces the spread (max - min). This
  // handles even-N short seasons where a symmetric drop equalises counts, but
  // correctly leaves odd-N (3-team) distributions alone — for 3 teams any
  // single drop also reduces the opponent's count, worsening balance.
  const balanceTrimmed: GeneratedFixture[] = [];
  if (fixtures.length > 0) {
    // Runs the balance trim over a specific pool of teams and fixtures.
    // Returns { kept, trimmed } where kept preserves original order within the pool.
    const runBalanceTrim = (poolFixtures: GeneratedFixture[], poolTeamIds: Set<string>):
      { kept: GeneratedFixture[]; trimmed: GeneratedFixture[] } => {
      const liveCounts = new Map<string, number>();
      for (const tid of poolTeamIds) liveCounts.set(tid, 0);
      for (const f of poolFixtures) {
        liveCounts.set(f.homeTeamId, (liveCounts.get(f.homeTeamId) ?? 0) + 1);
        liveCounts.set(f.awayTeamId, (liveCounts.get(f.awayTeamId) ?? 0) + 1);
      }
      const spread = () => {
        const vals = Array.from(liveCounts.values());
        if (vals.length === 0) return 0;
        return Math.max(...vals) - Math.min(...vals);
      };
      const kept: GeneratedFixture[] = [];
      const trimmed: GeneratedFixture[] = [];
      for (let i = poolFixtures.length - 1; i >= 0; i--) {
        const f = poolFixtures[i];
        const hCnt = liveCounts.get(f.homeTeamId) ?? 0;
        const aCnt = liveCounts.get(f.awayTeamId) ?? 0;
        const before = spread();
        if (before === 0) { kept.unshift(f); continue; }
        liveCounts.set(f.homeTeamId, hCnt - 1);
        liveCounts.set(f.awayTeamId, aCnt - 1);
        if (spread() < before) {
          trimmed.push(f);
        } else {
          liveCounts.set(f.homeTeamId, hCnt);
          liveCounts.set(f.awayTeamId, aCnt);
          kept.unshift(f);
        }
      }
      return { kept, trimmed };
    };

    if (teamDivisionMap && input.divisions && input.divisions.length > 0) {
      // Per-division balance trim — never drop a fixture from division A just to
      // equalise with division B which has a different gamesPerTeam.
      const trimmedSet = new Set<GeneratedFixture>();
      for (const div of input.divisions) {
        const poolTeamIds = new Set(div.teamIds);
        const poolFixtures = fixtures.filter(
          f => poolTeamIds.has(f.homeTeamId) && poolTeamIds.has(f.awayTeamId)
        );
        const { trimmed } = runBalanceTrim(poolFixtures, poolTeamIds);
        for (const t of trimmed) {
          trimmedSet.add(t);
          balanceTrimmed.push(t);
        }
      }
      fixtures = fixtures.filter(f => !trimmedSet.has(f));
    } else {
      const allTeamIds = new Set(input.teams.map(t => t.id));
      const { kept, trimmed } = runBalanceTrim(fixtures, allTeamIds);
      fixtures = kept;
      for (const t of trimmed) balanceTrimmed.push(t);
    }
  }

  // Build conflicts
  const conflicts: ScheduleConflict[] = [];

  // Home venue mismatch soft conflicts
  for (let i = 0; i < assigned.length; i++) {
    const { pairing, slot } = assigned[i];
    const homeTeam = input.teams.find(t => t.id === pairing.homeTeamId);
    if (homeTeam?.homeVenueId && slot.venueId !== homeTeam.homeVenueId) {
      conflicts.push({
        severity:     'soft',
        constraintId: 'home_venue_mismatch',
        description:  `Team ${homeTeam.name} playing home game away from their registered home venue`,
        fixtureIndex: i,
        teamId:       homeTeam.id,
      });
    }
    // No-home-venue warning
    if (!homeTeam?.homeVenueId) {
      conflicts.push({
        severity:     'soft',
        constraintId: 'no_home_venue',
        description:  `Team ${homeTeam?.name ?? pairing.homeTeamId} has no home venue; any available venue was used.`,
        fixtureIndex: i,
        teamId:       homeTeam?.id,
      });
    }
    // Practice rescheduling conflicts
    for (const pc of assigned[i].practiceConflicts) {
      const teamObj = input.teams.find(t => t.id === pc.teamId);
      conflicts.push({
        severity:     'soft',
        constraintId: 'practice_rescheduled',
        description:  `Team ${teamObj?.name ?? pc.teamId} has a practice on this date — practice will need rescheduling`,
        fixtureIndex: i,
        teamId:       pc.teamId,
      });
    }
  }

  // Hard conflicts for unassigned
  for (const { pairing, reason } of unassigned) {
    conflicts.push({
      severity:     'hard',
      constraintId: 'no_slot_found',
      description:  `No slot found for ${pairing.homeTeamName} vs ${pairing.awayTeamName} (${reason})`,
    });
  }
  for (const f of balanceTrimmed) {
    conflicts.push({
      severity:     'hard',
      constraintId: 'no_slot_found',
      description:  `${f.homeTeamName} vs ${f.awayTeamName} dropped to balance team game counts (balance_trim)`,
    });
  }

  // Compute team stats
  const teamStats: TeamScheduleStats[] = [];
  const N = input.teams.length;
  const isOdd = N % 2 === 1;

  for (const team of input.teams) {
    const teamFixtures = fixtures.filter(
      f => f.homeTeamId === team.id || f.awayTeamId === team.id
    );
    const homeGames = teamFixtures.filter(f => f.homeTeamId === team.id).length;
    const awayGames = teamFixtures.filter(f => f.awayTeamId === team.id).length;

    const dates = teamFixtures.map(f => f.date).sort();
    let minGap = Infinity;
    let maxGap = 0;
    for (let i = 1; i < dates.length; i++) {
      const gap = daysBetween(dates[i - 1], dates[i]);
      if (gap < minGap) minGap = gap;
      if (gap > maxGap) maxGap = gap;
    }

    // Find bye round (if odd N)
    let byeRound: number | undefined;
    if (isOdd) {
      // Find the round where this team is paired with BYE
      // We detect this by finding rounds where the team doesn't appear in fixtures
      const totalRoundsExpected = input.format === 'single_round_robin'
        ? N  // N-1 rounds + 1 bye round = N total
        : 2 * N - 1;
      const roundsPlayed = new Set(teamFixtures.map(f => f.round));
      for (let r = 1; r <= totalRoundsExpected; r++) {
        if (!roundsPlayed.has(r)) {
          byeRound = r;
          break;
        }
      }
    }

    teamStats.push({
      teamId:     team.id,
      teamName:   team.name,
      totalGames: teamFixtures.length,
      homeGames,
      awayGames,
      maxRestGap: dates.length > 1 ? maxGap : 0,
      minRestGap: dates.length > 1 ? minGap : 0,
      byeRounds:  isOdd ? 1 : 0,
      ...(byeRound !== undefined ? { byeRound } : {}),
    });
  }

  // Warnings
  const warnings: ScheduleAlgorithmOutput['warnings'] = [];
  if (isOdd) {
    warnings.push({
      code:    'ODD_TEAM_COUNT',
      message: `You have ${N} teams. Each team will have 1 bye round with no game scheduled. See team stats for details.`,
    });
  }

  // Warn when teams end up with unequal game counts (short season, odd-N, etc.).
  // BUG-14 / FW-46: for multi-division seasons, evaluate equality per-division so
  // divisions with different gamesPerTeam don't trigger a false warning.
  if (fixtures.length > 0) {
    const evaluatePool = (poolFixtures: GeneratedFixture[], poolTeamIds: Set<string>):
      { min: number; max: number } | null => {
      if (poolTeamIds.size === 0) return null;
      const counts = new Map<string, number>();
      for (const tid of poolTeamIds) counts.set(tid, 0);
      for (const f of poolFixtures) {
        if (poolTeamIds.has(f.homeTeamId)) counts.set(f.homeTeamId, (counts.get(f.homeTeamId) ?? 0) + 1);
        if (poolTeamIds.has(f.awayTeamId)) counts.set(f.awayTeamId, (counts.get(f.awayTeamId) ?? 0) + 1);
      }
      const vals = Array.from(counts.values());
      return { min: Math.min(...vals), max: Math.max(...vals) };
    };

    if (teamDivisionMap && input.divisions && input.divisions.length > 0) {
      let worstMin = Infinity;
      let worstMax = -Infinity;
      let unequal = false;
      for (const div of input.divisions) {
        const poolTeamIds = new Set(div.teamIds);
        const poolFixtures = fixtures.filter(
          f => poolTeamIds.has(f.homeTeamId) && poolTeamIds.has(f.awayTeamId)
        );
        const result = evaluatePool(poolFixtures, poolTeamIds);
        if (!result) continue;
        if (result.max > result.min) {
          unequal = true;
          if (result.min < worstMin) worstMin = result.min;
          if (result.max > worstMax) worstMax = result.max;
        }
      }
      if (unequal) {
        warnings.push({
          code:    'UNEQUAL_GAME_COUNTS',
          message: `Season has insufficient slots to give all teams equal games. Teams have between ${worstMin} and ${worstMax} games scheduled.`,
        });
      }
    } else {
      const allTeamIds = new Set(input.teams.map(t => t.id));
      const result = evaluatePool(fixtures, allTeamIds);
      if (result && result.max > result.min) {
        warnings.push({
          code:    'UNEQUAL_GAME_COUNTS',
          message: `Season has insufficient slots to give all teams equal games. Teams have between ${result.min} and ${result.max} games scheduled.`,
        });
      }
    }
  }

  // Fallback slots used
  const fallbackSlotsUsed = fixtures.filter(f => f.isFallbackSlot).length;

  const totalRequired = (() => {
    // BUG-12 / FW-45: when divisions are present, sum per-division requirements.
    if (input.divisions && input.divisions.length > 0) {
      let total = 0;
      for (const div of input.divisions) {
        const divGpt = div.gamesPerTeam ?? input.gamesPerTeam;
        if (divGpt !== undefined) {
          total += Math.ceil((divGpt * div.teamIds.length) / 2);
        } else {
          let dN = div.teamIds.length;
          if (dN % 2 === 1) dN += 1;
          total += (div.format === 'single_round_robin' || input.format === 'single_round_robin')
            ? (dN * (dN - 1)) / 2
            : dN * (dN - 1);
        }
      }
      return total;
    }
    let Nf = input.teams.length;
    if (Nf % 2 === 1) Nf += 1;
    const base = input.format === 'single_round_robin'
      ? (Nf * (Nf - 1)) / 2
      : Nf * (Nf - 1);
    if (input.gamesPerTeam !== undefined) {
      return Math.ceil((input.gamesPerTeam * input.teams.length) / 2);
    }
    return base;
  })();

  // Summary
  let summary: string;
  if (unassigned.length === 0) {
    summary = `${fixtures.length} fixtures scheduled successfully across ${
      new Set(fixtures.map(f => f.venueId)).size
    } venue(s).`;
  } else {
    summary = `${fixtures.length} of ${totalRequired} fixtures scheduled. ` +
      `${unassigned.length} pairing(s) could not be assigned — check constraint issues.`;
  }

  if (isOdd) {
    const byeList = teamStats
      .filter(s => s.byeRound !== undefined)
      .map(s => `${s.teamName}: Round ${s.byeRound}`)
      .join(', ');
    summary += ` ${N}-team league: each team has 1 bye round. Team bye assignments: [${byeList}]`;
  }

  return {
    fixtures,
    unassignedPairings: [
      ...unassigned.map(u => ({
        homeTeamId:   u.pairing.homeTeamId,
        homeTeamName: u.pairing.homeTeamName,
        awayTeamId:   u.pairing.awayTeamId,
        awayTeamName: u.pairing.awayTeamName,
        reason:       u.reason,
      })),
      ...balanceTrimmed.map(f => ({
        homeTeamId:   f.homeTeamId,
        homeTeamName: f.homeTeamName,
        awayTeamId:   f.awayTeamId,
        awayTeamName: f.awayTeamName,
        reason:       'balance_trim',
      })),
    ],
    conflicts,
    teamStats,
    stats: {
      totalFixturesRequired: totalRequired,
      assignedFixtures:      fixtures.length,
      unassignedFixtures:    unassigned.length + balanceTrimmed.length,
      fallbackSlotsUsed,
      feasible:              unassigned.length === 0 && balanceTrimmed.length === 0,
    },
    summary,
    warnings,
  };
}
