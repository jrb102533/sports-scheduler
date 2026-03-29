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

export interface ScheduleVenueInput {
  id:                  string;
  name:                string;
  concurrentPitches:   number;
  availabilityWindows: RecurringVenueWindowSched[];
  fallbackWindows?:    RecurringVenueWindowSched[];
  blackoutDates?:      string[];
}

export interface CoachAvailabilityInput {
  teamId:   string;
  weeklyWindows: {
    dayOfWeek: number;
    startTime: string;
    endTime:   string;
    available: boolean;
  }[];
  dateOverrides: {
    start:     string;
    end:       string;
    available: false;
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
}

// ─── Internal types ──────────────────────────────────────────────────────────

export interface Slot {
  date:                string;   // ISO "YYYY-MM-DD"
  venueId:             string;
  venueName:           string;
  startTime:           string;   // "HH:MM"
  endTime:             string;   // "HH:MM"
  concurrentCapacity:  number;
  isFallback:          boolean;
  key:                 string;   // "date|venueId|startTime"
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

  // Team and venue counts
  if (!Array.isArray(input.teams) || input.teams.length < 2 || input.teams.length > 20)
    err('teams must contain 2–20 entries');
  if (!Array.isArray(input.venues) || input.venues.length < 1 || input.venues.length > 10)
    err('venues must contain 1–10 entries');

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

  // Blackout dates
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
    if (v.concurrentPitches < 1 || v.concurrentPitches > 20)
      err('concurrentPitches must be 1–20');
    if (!v.availabilityWindows || v.availabilityWindows.length === 0)
      err(`venue ${v.name} has no availability windows`);
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
  const N = input.teams.length;
  if (input.gamesPerTeam !== undefined) {
    const max = input.format === 'single_round_robin' ? N - 1 : 2 * (N - 1);
    if (input.gamesPerTeam < 1 || input.gamesPerTeam > max)
      err(`gamesPerTeam ${input.gamesPerTeam} exceeds maximum ${max} for ${input.format} with ${N} teams`);
  }

  // Doubleheader validation
  if (input.doubleheader?.enabled && input.format !== 'double_round_robin')
    err('doubleheaders require format = double_round_robin');

  // Validate coach availability time formats
  for (const ca of (input.coachAvailability ?? [])) {
    for (const w of ca.weeklyWindows) {
      if (!TIME_RE.test(w.startTime) || !TIME_RE.test(w.endTime))
        err('times must be HH:MM 24-hour format');
    }
  }
}

// ─── §3 Step 0 — Feasibility Pre-Check ───────────────────────────────────

export function feasibilityPreCheck(input: GenerateScheduleInput): void {
  let N = input.teams.length;
  if (N % 2 === 1) N += 1;
  const requiredFixtures = input.format === 'single_round_robin'
    ? (N * (N - 1)) / 2
    : N * (N - 1);

  const seasonBlackouts = new Set(input.blackoutDates ?? []);
  let totalAvailableSlots = 0;

  for (const date of dateRange(input.seasonStart, input.seasonEnd)) {
    if (seasonBlackouts.has(date)) continue;
    const dow = dayOfWeek(date);
    for (const venue of input.venues) {
      const venueBlackouts = new Set(venue.blackoutDates ?? []);
      if (venueBlackouts.has(date)) continue;
      const allWindows = [
        ...venue.availabilityWindows.map(w => ({ ...w, fallback: false })),
        ...(venue.fallbackWindows ?? []).map(w => ({ ...w, fallback: true })),
      ];
      for (const window of allWindows) {
        if (window.dayOfWeek !== dow) continue;
        const windowDuration =
          timeToMinutes(window.endTime) - timeToMinutes(window.startTime);
        const slotSize = input.matchDurationMinutes + input.bufferMinutes;
        if (slotSize <= 0) continue;
        const slotsInWindow = Math.floor(windowDuration / slotSize);
        totalAvailableSlots += slotsInWindow * venue.concurrentPitches;
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

      // Primary windows first
      for (const window of venue.availabilityWindows) {
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

  let result = allPairings;

  // Double round-robin: add return fixtures
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

  // Partial round-robin: truncate to gamesPerTeam
  if (input.gamesPerTeam !== undefined) {
    const targetTotal = Math.floor((input.gamesPerTeam * input.teams.length) / 2);
    result = result.slice(0, targetTotal);
  }

  return result;
}

// ─── §3 Step 4 — Soft Constraint Scoring ─────────────────────────────────

function timesOverlap(
  slotStart: string, slotEnd: string,
  eventStart: string, eventEnd: string
): boolean {
  return timeToMinutes(slotStart) < timeToMinutes(eventEnd) &&
         timeToMinutes(slotEnd) > timeToMinutes(eventStart);
}

function computeCoachAvailabilityPenalty(
  slot: Slot,
  pairing: Pairing,
  coachAvailability: CoachAvailabilityInput[] | undefined,
): number {
  if (!coachAvailability) return 0;
  let penalty = 0;
  const slotDow = dayOfWeek(slot.date);
  const teamIds = [pairing.homeTeamId, pairing.awayTeamId];

  for (const teamId of teamIds) {
    const ca = coachAvailability.find(c => c.teamId === teamId);
    if (!ca) continue;

    // Check date overrides first
    let overrideFound = false;
    for (const ov of ca.dateOverrides) {
      if (slot.date >= ov.start && slot.date <= ov.end) {
        // Coach unavailable on this date
        penalty += 1;
        overrideFound = true;
        break;
      }
    }
    if (overrideFound) continue;

    // Check weekly windows
    const matchingWindows = ca.weeklyWindows.filter(w => w.dayOfWeek === slotDow);
    if (matchingWindows.length === 0) {
      // No window defined for this day = not available
      penalty += 1;
      continue;
    }
    const isAvailable = matchingWindows.some(
      w => w.available &&
           timeToMinutes(w.startTime) <= timeToMinutes(slot.startTime) &&
           timeToMinutes(w.endTime) >= timeToMinutes(slot.endTime)
    );
    if (!isAvailable) penalty += 1;
  }

  return penalty;
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

// ─── §3 Step 3 — Assignment Loop ─────────────────────────────────────────

export function assignFixtures(
  pairings: Pairing[],
  slots: Slot[],
  input: GenerateScheduleInput,
): AssignmentResult {
  const assigned: AssignmentResult['assigned'] = [];
  const unassigned: AssignmentResult['unassigned'] = [];

  // Per-team state
  const teamState = new Map<string, TeamState>();
  for (const t of input.teams) {
    teamState.set(t.id, {
      lastGameDate:    null,
      consecutiveAway: 0,
      homeCount:       0,
      awayCount:       0,
      gamesByDate:     new Set(),
      gameDates:       [],
    });
  }

  // Per-slot usage tracker (remaining capacity)
  const slotUsage = new Map<string, number>();
  for (const s of slots) {
    slotUsage.set(s.key, 0);
  }

  for (const pairing of pairings) {
    const home = teamState.get(pairing.homeTeamId)!;
    const away = teamState.get(pairing.awayTeamId)!;
    const homeTeam = input.teams.find(t => t.id === pairing.homeTeamId)!;

    let bestSlot: Slot | null = null;
    let bestPenalty = Infinity;

    for (const slot of slots) {
      // ── Hard constraint checks ──────────────────────────────────

      // 1. Venue capacity
      const usage = slotUsage.get(slot.key) ?? 0;
      if (usage >= slot.concurrentCapacity) continue;

      // 2. No same-day double-booking
      if (home.gamesByDate.has(slot.date)) continue;
      if (away.gamesByDate.has(slot.date)) continue;

      // 3. Minimum rest days (hard floor)
      if (home.lastGameDate !== null) {
        if (daysBetween(home.lastGameDate, slot.date) < input.minRestDays) continue;
      }
      if (away.lastGameDate !== null) {
        if (daysBetween(away.lastGameDate, slot.date) < input.minRestDays) continue;
      }

      // 4. Home venue hard enforcement
      if (input.homeAwayMode === 'strict' && input.homeVenueEnforcement === 'hard') {
        if (homeTeam.homeVenueId && slot.venueId !== homeTeam.homeVenueId) continue;
      }

      // ── Soft constraint scoring ─────────────────────────────────
      const penalty = scorePenalty(slot, pairing, home, away, input, homeTeam);

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

// ─── §2 Output Assembly ───────────────────────────────────────────────────

export function buildOutput(
  assignmentResult: AssignmentResult,
  input: GenerateScheduleInput,
): ScheduleAlgorithmOutput {
  const { assigned, unassigned } = assignmentResult;

  // Build fixture list
  const fixtures: GeneratedFixture[] = assigned.map(({ pairing, slot }) => ({
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
    isDoubleheader:  false,
    isFallbackSlot:  slot.isFallback,
  }));

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

  // Fallback slots used
  const fallbackSlotsUsed = fixtures.filter(f => f.isFallbackSlot).length;

  const totalRequired = (() => {
    let Nf = input.teams.length;
    if (Nf % 2 === 1) Nf += 1;
    const base = input.format === 'single_round_robin'
      ? (Nf * (Nf - 1)) / 2
      : Nf * (Nf - 1);
    if (input.gamesPerTeam !== undefined) {
      return Math.floor((input.gamesPerTeam * input.teams.length) / 2);
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
    unassignedPairings: unassigned.map(u => ({
      homeTeamId:   u.pairing.homeTeamId,
      homeTeamName: u.pairing.homeTeamName,
      awayTeamId:   u.pairing.awayTeamId,
      awayTeamName: u.pairing.awayTeamName,
      reason:       u.reason,
    })),
    conflicts,
    teamStats,
    stats: {
      totalFixturesRequired: totalRequired,
      assignedFixtures:      fixtures.length,
      unassignedFixtures:    unassigned.length,
      fallbackSlotsUsed,
      feasible:              unassigned.length === 0,
    },
    summary,
    warnings,
  };
}
