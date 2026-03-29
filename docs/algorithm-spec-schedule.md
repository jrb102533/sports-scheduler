# Deterministic Schedule Algorithm — Specification

**Version:** 1.1
**Date:** 2026-03-28
**Status:** Draft — 14 PM-approved amendments applied (review session 2026-03-28)
**Author:** Architect (Claude Sonnet 4.6)
**Replaces:** `generateLeagueSchedule` (LLM-based Cloud Function)
**Locked decisions source:** `docs/adr/ADR-005-deterministic-schedule-algorithm.md`

---

> **PM: This document is for review only. No implementation begins until you approve it.**
> Engineer agents: read every section. The pseudocode in §3 is the implementation contract.

---

## Table of Contents

1. [Input Schema](#1-input-schema)
2. [Output Schema](#2-output-schema)
3. [Algorithm Design](#3-algorithm-design)
4. [Round-Robin Formula](#4-round-robin-formula)
5. [Home/Away Assignment](#5-homeaway-assignment)
6. [Doubleheader Logic](#6-doubleheader-logic)
7. [Constraint Priority Model](#7-constraint-priority-model)
8. [Edge Cases and Error Conditions](#8-edge-cases-and-error-conditions)
9. [Performance Expectations](#9-performance-expectations)
10. [Cloud Function Interface](#10-cloud-function-interface)

---

## 1. Input Schema

### 1.1 Full TypeScript Interface

```typescript
// ── Sub-types ────────────────────────────────────────────────────────────────

/** A recurring weekly availability window for a venue. */
export interface RecurringVenueWindow {
  dayOfWeek: number;   // 0 = Sunday … 6 = Saturday
  startTime: string;   // "HH:MM" 24-hour
  endTime:   string;   // "HH:MM" 24-hour; must be > startTime
}

/** One team as provided to the scheduler. */
export interface ScheduleTeamInput {
  id:           string;  // Firestore team document ID
  name:         string;  // display name
  homeVenueId?: string;  // ID of team's home venue in the venues array; absent = no home venue
}

/** One venue as provided to the scheduler. */
export interface ScheduleVenueInput {
  id:                  string;                  // stable ID (Firestore venueId or wizard-generated)
  name:                string;                  // display name
  concurrentPitches:   number;                  // how many simultaneous games this venue supports; min 1
  availabilityWindows: RecurringVenueWindow[];  // primary recurring windows (required; non-empty)
  fallbackWindows?:    RecurringVenueWindow[];  // used only when primary cannot fill the schedule
  blackoutDates?:      string[];                // venue-specific ISO date strings ("YYYY-MM-DD")
}

/** Coach availability response (from availability collection). */
export interface CoachAvailabilityInput {
  teamId:   string;
  weeklyWindows: {
    dayOfWeek: number;   // 0–6
    startTime: string;   // "HH:MM"
    endTime:   string;   // "HH:MM"
    available: boolean;
  }[];
  dateOverrides: {
    start:     string;   // ISO date
    end:       string;   // ISO date
    available: false;
  }[];
}

/** Soft constraint identifiers — must match the wizard's preference list. */
export type SoftConstraintId =
  | 'prefer_weekends'          // schedule weekends first; weekdays only as fallback
  | 'balance_home_away'        // equalise home/away count per team
  | 'minimise_doubleheaders'   // avoid same-team doubleheaders when not opted in
  | 'respect_coach_availability' // weight slots by coach availability data
  | 'avoid_practice_conflicts'   // avoid slots overlapping published practice sessions
  | 'min_rest_days'              // soft floor on rest (applied after hard minimum)
  | 'max_consecutive_away';      // limit consecutive away fixtures

/** Doubleheader configuration. Absent = doubleheaders disabled. */
export interface DoubleheaderConfig {
  enabled:       boolean;  // must be true for any doubleheader scheduling
  bufferMinutes: number;   // gap between game 1 end and game 2 start; 0 = back-to-back
}

// ── Primary input ─────────────────────────────────────────────────────────────

export interface GenerateScheduleInput {
  // Context
  leagueId:   string;
  leagueName: string;

  // Teams and venues
  teams:  ScheduleTeamInput[];   // 2–20 teams
  venues: ScheduleVenueInput[];  // 1–10 venues

  // Season configuration
  seasonStart:          string;  // ISO date "YYYY-MM-DD"
  seasonEnd:            string;  // ISO date "YYYY-MM-DD"
  format:               'single_round_robin' | 'double_round_robin';
  matchDurationMinutes: number;  // 30–240
  bufferMinutes:        number;  // 0–120; gap between consecutive games at a venue
  minRestDays:          number;  // 0–14; hard minimum days between a team's games (default 1)

  // Season-wide blackout dates (union with per-venue blackouts)
  blackoutDates?: string[];  // ISO date strings

  // Soft constraint priority (ordered list, index 0 = highest priority)
  // Constraints not listed are treated as disabled.
  softConstraintPriority: SoftConstraintId[];

  // Coach availability (optional; powers 'respect_coach_availability' soft constraint)
  coachAvailability?: CoachAvailabilityInput[];

  // Doubleheader opt-in
  doubleheader?: DoubleheaderConfig;

  // Home/away venue mode (Amendment 6)
  homeAwayMode: 'strict' | 'relaxed';  // default: 'relaxed'
  // 'relaxed': home/away roles are used for display/stats only; no venue matching attempted;
  //            'balance_home_away' soft constraint applies normally.
  // 'strict':  home team plays at their homeVenueId (soft enforcement by default per Amendment 2);
  //            'balance_home_away' soft constraint gets doubled weight.
  // Note: baseball/softball typically use 'strict'; most other sports use 'relaxed'.

  // Home venue enforcement mode when homeAwayMode = 'strict' (Amendment 7)
  homeVenueEnforcement?: 'hard' | 'soft';  // only relevant when homeAwayMode = 'strict'; default: 'soft'
  // 'soft' (default for strict mode): home venue mismatch is a soft conflict in preview —
  //   LM can publish with warnings.
  // 'hard': home venue mismatch is a hard conflict — fixture goes to unassignedPairings if
  //   home venue has no slot; blocks publish.
  // When homeAwayMode = 'relaxed', this field is ignored.

  // Practice events (Amendment 8) — separate from coachAvailability
  practiceEvents?: Array<{
    teamId: string;
    date: string;       // ISO date
    startTime: string;  // "HH:MM"
    endTime: string;    // "HH:MM"
    reschedulable: boolean;  // true = LM can schedule game here; flagged as soft conflict
                             // false = treat as unavailable (soft penalty)
  }>;
  // Amendment 14 — Opt-in toggle:
  // The wizard only passes practiceEvents when the LM has 'avoid_practice_conflicts'
  // enabled in their soft constraint priority list. When the toggle is off, practiceEvents
  // is omitted from the call entirely (treated as absent/empty by the algorithm).
  // The wizard fetches practice events from Firestore
  //   (scheduledEvents where type = 'practice' AND teamId in enrolledTeams
  //    AND date between seasonStart and seasonEnd)
  // only when the toggle is on. This avoids unnecessary Firestore reads for leagues
  // that do not use practice conflict avoidance.

  // Soft constraint fine-tuning
  maxConsecutiveAway?: number;  // default 3; max consecutive away fixtures before penalty

  // Partial round-robin (Amendment 10)
  gamesPerTeam?: number;  // if absent, defaults to full round-robin for the chosen format
}
```

### 1.2 Input Validation Rules

These are enforced before the algorithm runs. Violations return an `invalid-argument` error immediately.

| Rule | Hard limit | Error message |
|---|---|---|
| Team count | 2–20 | `"teams must contain 2–20 entries"` |
| Venue count | 1–10 | `"venues must contain 1–10 entries"` |
| Total blackout dates (season + per-venue combined) | ≤ 365 | `"too many blackout dates"` |
| Season span | 1–365 days | `"seasonEnd must be after seasonStart by at most 365 days"` |
| `matchDurationMinutes` | 30–240 | `"matchDurationMinutes must be 30–240"` |
| `bufferMinutes` | 0–120 | `"bufferMinutes must be 0–120"` |
| `minRestDays` | 0–14 | `"minRestDays must be 0–14"` |
| `maxConsecutiveAway` | 1–10 | `"maxConsecutiveAway must be 1–10"` |
| Date format | ISO `"YYYY-MM-DD"` | `"dates must be ISO format YYYY-MM-DD"` |
| Time format | `"HH:MM"` 24-hour | `"times must be HH:MM 24-hour format"` |
| Venue `concurrentPitches` | 1–20 | `"concurrentPitches must be 1–20"` |
| Each venue must have ≥ 1 primary availability window | — | `"venue {name} has no availability windows"` |
| `softConstraintPriority` values must all be valid `SoftConstraintId` | — | `"unknown soft constraint: {id}"` |
| Team IDs must be unique | — | `"duplicate team id: {id}"` |
| Venue IDs must be unique | — | `"duplicate venue id: {id}"` |
| `homeVenueId` on a team must reference a venue ID in the `venues` array | — | `"team {name} homeVenueId references unknown venue {id}"` |
| `format` must be `single_round_robin` or `double_round_robin` | — | `"unsupported format: {format}"` |
| `gamesPerTeam` for `single_round_robin` | 1 ≤ value ≤ N−1 | `"gamesPerTeam {value} exceeds maximum {max} for {format} with {N} teams"` |
| `gamesPerTeam` for `double_round_robin` | 1 ≤ value ≤ 2(N−1) | `"gamesPerTeam {value} exceeds maximum {max} for {format} with {N} teams"` |
| `homeVenueEnforcement` is only meaningful when `homeAwayMode = 'strict'` | — | Silently ignored when `homeAwayMode = 'relaxed'` |
| `doubleheader.enabled = true` requires `format = 'double_round_robin'` | — | `"doubleheaders require format = double_round_robin"` |

---

## 2. Output Schema

```typescript
/** One scheduled fixture. */
export interface GeneratedFixture {
  round:         number;   // 1-indexed round number
  homeTeamId:    string;
  homeTeamName:  string;
  awayTeamId:    string;
  awayTeamName:  string;
  date:          string;   // ISO date "YYYY-MM-DD"
  startTime:     string;   // "HH:MM" 24-hour
  endTime:       string;   // "HH:MM" 24-hour; startTime + matchDurationMinutes
  venueId:       string;
  venueName:     string;
  isDoubleheader: boolean;  // true if this fixture is part of a doubleheader pair
  doubleheaderSlot?: 1 | 2; // position within the pair (absent when isDoubleheader = false)
  isFallbackSlot:  boolean; // true if this fixture used a fallback venue window
}

/** A constraint violation attached to a specific fixture or team. */
export interface ScheduleConflict {
  severity:     'hard' | 'soft';
  constraintId: string;            // e.g. 'no_slot_found', 'min_rest_days', 'balance_home_away'
  description:  string;            // human-readable; shown in wizard preview
  fixtureIndex?: number;           // index into fixtures[] if conflict is fixture-specific
  teamId?:       string;           // team affected (absent = league-wide)
}

/** Per-team statistics for the preview step. */
export interface TeamScheduleStats {
  teamId:         string;
  teamName:       string;
  totalGames:     number;
  homeGames:      number;
  awayGames:      number;
  maxRestGap:     number;  // longest gap in days between consecutive games
  minRestGap:     number;  // shortest gap in days between consecutive games
  byeRounds:      number;  // rounds where this team has no game (odd-N only)
  byeRound?:      number;  // the specific round number in which this team has a bye (absent if N is even)
}

/** Top-level output. */
export interface ScheduleAlgorithmOutput {
  fixtures:          GeneratedFixture[];
  unassignedPairings: Array<{
    homeTeamId:  string;
    homeTeamName: string;
    awayTeamId:  string;
    awayTeamName: string;
    reason:      string;  // why no slot could be found
  }>;
  conflicts:  ScheduleConflict[];
  teamStats:  TeamScheduleStats[];
  stats: {
    totalFixturesRequired:  number;  // from round-robin formula
    assignedFixtures:       number;
    unassignedFixtures:     number;
    fallbackSlotsUsed:      number;
    feasible:               boolean; // true only when unassignedFixtures === 0
  };
  summary: string;  // human summary for wizard preview banner
  // When N is odd, summary must mention bye rounds, e.g.:
  //   "7-team league: each team has 1 bye round. Team bye assignments: [Team A: Round 3, ...]"
  warnings: Array<{
    code: string;
    message: string;  // human-readable; shown as banner in wizard preview
  }>;
  // When N is odd, warnings always includes:
  //   { code: 'ODD_TEAM_COUNT', message: "You have {N} teams. Each team will have 1 bye round
  //     with no game scheduled. See team stats for details." }
}
```

---

## 3. Algorithm Design

The algorithm is a **greedy slot-assignment with soft-constraint scoring**. There is no backtracking in the base implementation. The assignment order is deterministic (sorted inputs produce the same output every run).

If the greedy pass leaves unassigned fixtures, the output is a partial schedule plus a conflict list — it is never a hard function failure (see §8 for the exception list).

### Step 0: Feasibility Pre-Check

**Goal:** Fast upfront check before any slots are generated. Catches grossly under-resourced configurations before expensive computation.

```
function feasibilityPreCheck(input: GenerateScheduleInput): void {
  // Calculate required fixtures from the round-robin formula (§4.1)
  N = input.teams.length
  if N % 2 === 1: N += 1  // virtual bye team
  requiredFixtures = (input.format === 'single_round_robin')
    ? (N * (N - 1)) / 2
    : N * (N - 1)

  // Raw slot capacity: sum all time slots across all venues in the season window
  // before any constraint filtering — just calendar × windows × pitches
  totalAvailableSlots = 0
  for date in dateRange(input.seasonStart, input.seasonEnd):
    dow = date.dayOfWeek()
    for venue in input.venues:
      for window in ([...venue.availabilityWindows, ...(venue.fallbackWindows ?? [])]):
        if window.dayOfWeek !== dow: continue
        slotsInWindow = floor(windowDurationMinutes / (matchDurationMinutes + bufferMinutes))
        totalAvailableSlots += slotsInWindow * venue.concurrentPitches

  // Threshold: if raw capacity is less than 50% of required, reject immediately
  if totalAvailableSlots < requiredFixtures * 0.5:
    throw new HttpsError(
      'invalid-argument',
      `Season configuration is infeasible: only ${totalAvailableSlots} slots available ` +
      `for ${requiredFixtures} required fixtures. Extend the season window, add venues, ` +
      `or reduce team count.`
    )
}
```

This check fires **before** slot generation or assignment. It is a fast O(D × V × W) scan — the same order as slot generation, but much lighter. It does **not** guarantee feasibility; it only rejects obviously impossible configurations (< 50% raw capacity).

### Step 1: Slot Generation

**Goal:** Produce an ordered list of all candidate time slots across all venues, filtered to the season window and excluding blackout dates.

```
function generateSlots(input: GenerateScheduleInput): Slot[] {
  slots = []

  // Iterate every calendar date in [seasonStart, seasonEnd]
  for date in dateRange(input.seasonStart, input.seasonEnd):
    if date in input.blackoutDates: continue

    dow = date.dayOfWeek()   // 0=Sun … 6=Sat

    for venue in input.venues:
      if date in venue.blackoutDates: continue

      // Try primary windows first, then fallback
      for window in (venue.availabilityWindows):
        if window.dayOfWeek != dow: continue

        slotStart = window.startTime
        while slotStart + matchDurationMinutes <= window.endTime:
          slots.push({
            date, venueId: venue.id, startTime: slotStart,
            concurrentCapacity: venue.concurrentPitches,
            isFallback: false,
          })
          slotStart += matchDurationMinutes + bufferMinutes

      for window in (venue.fallbackWindows ?? []):
        if window.dayOfWeek != dow: continue
        // Same inner loop; mark isFallback: true

  // Sort: primary before fallback; within same type, weekends before weekdays
  // (when prefer_weekends soft constraint is active)
  slots = sortSlots(slots, input.softConstraintPriority)

  return slots
}
```

**Concurrency tracking:** Each slot carries a remaining capacity counter (`concurrentPitches`). When a fixture is assigned to a slot, capacity decrements by 1. A slot is unavailable when capacity reaches 0.

### Step 2: Fixture Pairing Generation

**Goal:** Produce all required matchups in a canonical order.

See §4 for the round-robin formula. The output of this step is:

```typescript
interface Pairing {
  homeTeamId:  string;
  awayTeamId:  string;
  round:       number;
  pairingIndex: number;  // global ordering key for assignment priority
}
```

Pairings are sorted by round, then by `pairingIndex` within round. This makes the assignment deterministic.

### Step 3: Assignment Loop

**Goal:** For each pairing, find the best available slot that satisfies all hard constraints and minimises soft constraint penalties.

```
function assignFixtures(pairings: Pairing[], slots: Slot[], input): Assignment[] {
  assigned   = []
  unassigned = []

  // ── Seed-based shuffle (Amendment 1) ────────────────────────────────────────
  // Pairings arrive sorted by round then pairingIndex (deterministic base order).
  // Apply a Fisher-Yates shuffle using a fixed seed so that no round has systematic
  // priority in slot selection, while retaining full determinism for same inputs.
  //
  // Seed derivation:
  //   seedInput = input.leagueId + "|" + input.seasonStart
  //   seed (uint32) = fnv32a(seedInput)   // FNV-1a 32-bit hash
  //
  // Fisher-Yates with seeded PRNG (e.g., mulberry32 from seed):
  //   rng = mulberry32(seed)
  //   for i from pairings.length - 1 downto 1:
  //     j = floor(rng() * (i + 1))
  //     swap(pairings[i], pairings[j])
  //
  // Same leagueId + seasonStart always produce the same shuffle.
  pairings = seededShuffle(pairings, deriveScheduleSeed(input.leagueId, input.seasonStart))
  // ─────────────────────────────────────────────────────────────────────────────

  // Track per-team state for constraint checking
  teamState: Map<teamId, {
    lastGameDate: Date | null,
    consecutiveAway: number,
    homeCount: number,
    awayCount: number,
    gamesByDate: Set<string>,  // ISO dates already occupied
  }>

  // Track per-slot usage
  slotUsage: Map<slotKey, number>  // slotKey = "date|venueId|startTime"

  for pairing in pairings:
    home = teamState[pairing.homeTeamId]
    away = teamState[pairing.awayTeamId]

    bestSlot    = null
    bestPenalty = Infinity

    for slot in slots:
      // ── Hard constraint checks ──────────────────────────────────

      // 1. Venue capacity
      if slotUsage[slot.key] >= slot.concurrentCapacity: continue

      // 2. No same-day double-booking (either team)
      if slot.date in home.gamesByDate: continue
      if slot.date in away.gamesByDate: continue

      // 3. Minimum rest days (hard floor)
      if home.lastGameDate != null:
        if daysBetween(home.lastGameDate, slot.date) < input.minRestDays: continue
      if away.lastGameDate != null:
        if daysBetween(away.lastGameDate, slot.date) < input.minRestDays: continue

      // 4. Home venue is a SOFT constraint (Amendment 2).
      //    No slot is skipped based on venue. Instead, a penalty is applied below
      //    when the slot is not at the home team's preferred venue.
      //    If homeAwayMode = 'strict' AND homeVenueEnforcement = 'hard', then
      //    a slot at the wrong venue is hard-blocked:
      if input.homeAwayMode === 'strict' && input.homeVenueEnforcement === 'hard':
        if home.homeVenueId != null && slot.venueId != home.homeVenueId: continue

      // ── Soft constraint scoring ─────────────────────────────────
      penalty = scorePenalty(slot, pairing, home, away, input)

      if penalty < bestPenalty:
        bestPenalty = penalty
        bestSlot    = slot

    if bestSlot != null:
      // Commit assignment
      assigned.push({ pairing, slot: bestSlot, penalty: bestPenalty })
      slotUsage[bestSlot.key]++

      // Update team state
      home.lastGameDate     = bestSlot.date
      home.homeCount++
      home.gamesByDate.add(bestSlot.date)

      away.lastGameDate     = bestSlot.date
      away.consecutiveAway++  // reset home's consecutiveAway counter
      away.awayCount++
      away.gamesByDate.add(bestSlot.date)

    else:
      unassigned.push({
        pairing,
        reason: explainNoSlot(pairing, slots, teamState, input),
      })

  return { assigned, unassigned }
}
```

**Home venue constraint detail (Amendment 2):** Home venue matching is a **soft constraint** by default. When a slot is not at the home team's `homeVenueId`, the `scorePenalty` function adds a low penalty, making same-venue slots preferred. If no same-venue slot exists, the best available slot at any venue is used and a soft conflict is recorded:

```
{ constraintId: 'home_venue_mismatch', severity: 'soft',
  description: "Team {name} playing home game away from their registered home venue" }
```

The exception is when `homeAwayMode = 'strict'` AND `homeVenueEnforcement = 'hard'`: in that case the venue check is a hard gate (slot skipped if wrong venue), and a failed pairing goes to `unassignedPairings`. See §5 and §1.1 for full details. The home/away swap fallback (formerly §5.3) has been removed; it was only needed for the hard constraint.

### Step 4: Soft Constraint Scoring

The `scorePenalty` function returns a non-negative integer. Lower = better. Weights are derived from the position of each `SoftConstraintId` in `softConstraintPriority` (index 0 = highest priority = highest weight applied to violations).

```
function scorePenalty(slot, pairing, home, away, input): number {
  penalty = 0

  // Iterate the priority list from highest to lowest priority.
  // Higher-priority constraints have linearly larger weights (Amendment 4).
  // Rationale: linear weights keep lower-priority constraints in dialogue with
  // higher ones. Exponential weights would make the top constraint dominate
  // overwhelmingly, effectively ignoring everything below it.
  //
  // Example with 7 constraints: weights are 7, 6, 5, 4, 3, 2, 1
  priorityCount = input.softConstraintPriority.length
  for (i, constraintId) in enumerate(input.softConstraintPriority):
    weight = priorityCount - i + 1   // e.g., 7 constraints → weights 7, 6, 5, 4, 3, 2, 1

    switch constraintId:

      case 'prefer_weekends':
        if slot.date.isWeekday(): penalty += weight

      case 'balance_home_away':
        imbalance = abs(home.homeCount - home.awayCount)
        // Penalty grows with imbalance; home team is the relevant side
        if imbalance > 1: penalty += weight * imbalance

      case 'minimise_doubleheaders':
        // Only relevant when doubleheader mode is off; handled in §6 when on
        if slot.date in home.gamesByDate || slot.date in away.gamesByDate:
          penalty += weight * 10   // strong discouragement (not a hard block)

      case 'respect_coach_availability':
        coachPenalty = computeCoachAvailabilityPenalty(slot, pairing, input.coachAvailability)
        penalty += weight * coachPenalty

      case 'min_rest_days':
        // Soft extension above the hard minimum
        softRestDays = input.minRestDays + 1
        if home.lastGameDate != null:
          gap = daysBetween(home.lastGameDate, slot.date)
          if gap < softRestDays: penalty += weight * (softRestDays - gap)
        if away.lastGameDate != null:
          gap = daysBetween(away.lastGameDate, slot.date)
          if gap < softRestDays: penalty += weight * (softRestDays - gap)

      case 'max_consecutive_away':
        maxAway = input.maxConsecutiveAway ?? 3
        if away.consecutiveAway >= maxAway: penalty += weight * away.consecutiveAway

      case 'avoid_practice_conflicts':
        // practiceEvents is a separate input field (Amendment 8).
        // coachAvailability is for personal coach availability only.
        for practiceEvent in (input.practiceEvents ?? []):
          if practiceEvent.teamId !== pairing.homeTeamId
            && practiceEvent.teamId !== pairing.awayTeamId: continue
          if slot.date !== practiceEvent.date: continue
          if timesOverlap(slot, practiceEvent):
            if practiceEvent.reschedulable === false:
              penalty += weight   // full penalty; treat as unavailable
            // reschedulable === true: no penalty (slot is usable), but after
            // assignment a soft conflict is added:
            //   { constraintId: 'practice_rescheduled', severity: 'soft',
            //     description: "Team {name} has a practice on this date —
            //                   practice will need rescheduling" }
            // That post-assignment step is handled in the commit block above.

  return penalty
}
```

**Coach availability penalty:** For each team in a pairing, query `coachAvailability` for that team's `weeklyWindows` and `dateOverrides`. If the proposed slot falls in an unavailable window for either team's coach, add weight. The penalty is additive — both coaches unavailable = 2× the weight. `coachAvailability` is for personal coach schedules only; practice sessions are handled via the separate `practiceEvents` field (Amendment 8).

**Home venue mismatch penalty (Amendment 2):** When `homeAwayMode = 'relaxed'`, or `homeAwayMode = 'strict'` with `homeVenueEnforcement = 'soft'`, add a low fixed penalty when the slot's `venueId` does not match the home team's `homeVenueId`. This makes same-venue slots preferred without hard-blocking other venues. Suggested penalty coefficient: `weight_of_lowest_priority_constraint` (i.e., 1 × the lowest weight in the list).

### Step 5: Infeasibility Handling

The algorithm never throws an error due to infeasibility. Instead it returns a partial schedule with a populated `unassignedPairings` array and `stats.feasible = false`.

The `reason` field in each unassigned pairing is a machine-readable code plus a human label:

| Code | Human label |
|---|---|
| `NO_SLOT_IN_SEASON` | No available slot in the season window |
| `REST_CONFLICT` | Minimum rest days cannot be met |
| `HOME_VENUE_NO_SLOT` | Home venue has no available window for this pairing |
| `CAPACITY_EXHAUSTED` | All venue slots for this date range are at full capacity |
| `BOTH_HOME_VENUES_CONFLICT` | Both teams have home venues with no shared available days |

The wizard preview step surfaces these as hard conflicts that block publish until the LM either re-runs with adjusted parameters or manually removes fixtures.

---

## 4. Round-Robin Formula

### 4.1 Total Fixtures

| Format | Formula | Example (N = 8) |
|---|---|---|
| `single_round_robin` | N × (N − 1) / 2 | 28 fixtures |
| `double_round_robin` | N × (N − 1) | 56 fixtures |

### 4.2 Odd Number of Teams (Bye Rounds)

When N is odd, a virtual "bye" team is added to make N even. Any team paired with the bye team sits out that round. The bye team is never assigned a venue or slot.

```
if teams.length % 2 === 1:
  teams = [...teams, { id: 'BYE', name: 'BYE' }]
  // Pairings with BYE team are skipped during assignment
```

With N = 5 (odd), the scheduler adds a bye to make N = 6, generating 6 × 5 / 2 = 15 pairings, 5 of which involve the bye and are dropped. Final fixture count = 10.

With N = 5 and double round-robin: 6 × 5 = 30 pairings, 10 with bye dropped. Final = 20 fixtures.

**Output requirements when N is odd (Amendment 5):**

- Each `TeamScheduleStats` entry includes `byeRound: number` — the specific round in which that team is paired with the bye.
- The `summary` string must mention bye rounds, e.g.:
  `"7-team league: each team has 1 bye round. Team bye assignments: [Team A: Round 3, Team B: Round 1, ...]"`
- `ScheduleAlgorithmOutput.warnings` must include:
  `{ code: 'ODD_TEAM_COUNT', message: "You have 7 teams. Each team will have 1 bye round with no game scheduled. See team stats for details." }`

### 4.3 Partial Round-Robin

A partial round-robin applies when the LM's requested game count per team is less than the full `N − 1` rounds required for everyone to play everyone once.

**Formula:**

```
gamesPerTeam = input.gamesPerTeam   // if provided by wizard
maxGamesPerTeam = N - 1             // full single round-robin

if gamesPerTeam < maxGamesPerTeam:
  // Use a balanced subset of pairs.
  // Algorithm: take full round-robin pairing list, distribute rounds evenly,
  // then truncate after (gamesPerTeam × N / 2) total fixtures.
  // Ensure no team is over-represented in the truncated set.
```

**Validation (Amendment 10):**

| Format | Valid range for `gamesPerTeam` |
|---|---|
| `single_round_robin` | 1 ≤ `gamesPerTeam` ≤ N − 1 |
| `double_round_robin` | 1 ≤ `gamesPerTeam` ≤ 2(N − 1) |

Error message when exceeded: `"gamesPerTeam {value} exceeds maximum {max} for {format} with {N} teams"`

If `gamesPerTeam` is absent, the algorithm defaults to a full round-robin for the chosen format. The wizard's config step is responsible for deriving `gamesPerTeam` from the LM's inputs before calling the Cloud Function.

---

## 5. Home/Away Assignment

### 5.1 Default Balanced Rotation

Home/away roles are assigned using the **circle method** (standard round-robin scheduling). The circle method naturally alternates home/away across rounds for each pair.

For each round r in [1 … N−1]:
- One team is fixed (index 0); the other N−1 rotate.
- The fixed team alternates home/away each round.
- All other pairs' home/away is determined by their position in the rotation.

This produces the most balanced home/away split possible given N.

### 5.2 Using homeVenueId (Amendment 2)

Home venue is a **soft constraint**. The algorithm does not filter slots to the home team's venue; instead, it applies a penalty in `scorePenalty` when the slot is not at the `homeVenueId`. This means:

1. If the home venue has available slots, they will be preferred (lower penalty).
2. If the home venue has no available slots, any other venue is used and a soft conflict is added:
   `{ constraintId: 'home_venue_mismatch', severity: 'soft', description: "Team {name} playing home game away from their registered home venue" }`
3. The fixture's `venueId` and `venueName` reflect whichever venue was actually used.

**Exception — `homeVenueEnforcement: 'hard'` (Amendment 7):** When `homeAwayMode = 'strict'` and `homeVenueEnforcement = 'hard'`, home venue matching becomes a hard gate again: any slot not at the home team's `homeVenueId` is skipped. If no slot is found at the home venue, the pairing goes to `unassignedPairings` with reason `HOME_VENUE_NO_SLOT`.

When a team is assigned the away role, their `homeVenueId` is irrelevant. The fixture's venue is determined by the slot selected.

### 5.3 Home/Away Swap — Removed

The home/away swap fallback (swap roles when home venue has no slot) has been removed. It was only necessary under the old hard-constraint model. With the soft-constraint model (Amendment 2), any venue can be used and the mismatch is surfaced as a warning rather than causing an unassigned fixture.

### 5.4 Team with No homeVenueId

If a team has no `homeVenueId`:
- When scheduled as home, the algorithm selects the best available venue across all venues in the input (same slot-scoring logic applies).
- No venue constraint is applied. The home/away label still determines which team is listed as host.
- This is treated as a soft warning in the output conflicts list: `"Team {name} has no home venue; any available venue was used."`

---

## 6. Doubleheader Logic

### 6.1 Definition (Amendment 9)

A doubleheader means **the same two teams play twice on the same day at the same venue**, with games separated by `doubleheader.bufferMinutes`. This is **not** two different matchups sharing a venue on the same day — that is normal venue scheduling handled by `concurrentPitches`.

Doubleheaders require `format = 'double_round_robin'`. In a double round-robin, each pair of teams meets twice; a doubleheader schedules both legs on the same day rather than spreading them across the season. When `doubleheader.enabled = true` and `format ≠ 'double_round_robin'`, validation rejects the input with: `"doubleheaders require format = double_round_robin"`.

### 6.2 Activation

Doubleheaders are only scheduled when `input.doubleheader.enabled === true`. When disabled, the `minimise_doubleheaders` soft constraint discourages (but does not hard-block) same-day games for a team.

### 6.3 Slot Structure for Doubleheaders

A doubleheader is two fixtures at the **same venue** on the **same date**, involving the **same two teams**, back-to-back with a configurable buffer.

```
Game 1: startTime = S;      endTime = S + matchDurationMinutes
Buffer: bufferMinutes (from doubleheader.bufferMinutes, may be 0)
Game 2: startTime = S + matchDurationMinutes + bufferMinutes
```

Both games must fit within a single venue availability window:
```
S + 2 × matchDurationMinutes + bufferMinutes ≤ window.endTime
```

### 6.4 Home/Away Alternation

Within a doubleheader pair:
- Game 1: Team A is home, Team B is away.
- Game 2: Team B is home, Team A is away.

The team that is home in Game 1 is determined by the circle-method assignment for that pairing's round. The swap for Game 2 is automatic.

### 6.5 Assignment Loop Modification for Doubleheaders

When doubleheaders are enabled, the assignment loop processes doubleheader pairings in pairs:

```
// After generating pairings, identify which pairings can be grouped as doubleheaders.
// Strategy: pair up fixtures involving the same two teams in consecutive rounds.
doubleheaderCandidates = findDoubleheaderCandidates(pairings)

for candidate in doubleheaderCandidates:
  // Find a slot where BOTH games fit at the same venue on the same day
  bestSlot = findDoubleheaderSlot(candidate, slots, teamState, input)
  if bestSlot:
    assign both fixtures to the slot pair
  else:
    // Fall back: schedule each fixture independently
    addToRegularQueue(candidate.game1, candidate.game2)
```

The `findDoubleheaderSlot` function applies the same hard constraint checks as the regular assignment loop, for both games simultaneously.

---

## 7. Constraint Priority Model

### 7.1 Hard vs. Soft

Hard constraints are checked as binary pass/fail gates in the inner loop (Step 3). A slot that fails any hard constraint is unconditionally skipped. Hard constraints are **never** relaxed.

Hard constraints:
1. Venue capacity (no double-booking beyond `concurrentPitches`)
2. No same-day game for either team (each team plays at most once per calendar day, unless doubleheaders are enabled)
3. Minimum rest days (`minRestDays`)
4. Home venue assignment — only when `homeAwayMode = 'strict'` AND `homeVenueEnforcement = 'hard'` (Amendment 2/7); soft by default

Soft constraints are applied as scoring penalties (Step 4). A slot that incurs soft penalties is still used if no lower-penalty slot exists.

### 7.2 Relaxation Order

When the schedule is tight (few available slots), soft constraints are naturally relaxed by the scoring system — the lowest-penalty available slot is chosen even if it violates lower-priority soft constraints.

The LM-controlled priority list directly controls which soft constraints tolerate violations last:
- **Highest priority (index 0):** violation avoided longest; only violated as a last resort.
- **Lowest priority (last index):** violated first when slots are scarce.

For example, if the LM orders:
```
[ 'prefer_weekends', 'balance_home_away', 'min_rest_days' ]
```
The algorithm will schedule weekday games before it creates home/away imbalances, and tolerate rest gaps before accepting imbalance.

### 7.3 Weight Formula (Amendment 4)

Weights are **linear**, not exponential:

```
weight(i) = priorityCount - i + 1
```

Example with 7 constraints: weights are 7, 6, 5, 4, 3, 2, 1.

**Rationale:** Linear weights keep lower-priority constraints in dialogue with higher-priority ones. An exponential formula (2^n) would make the top constraint dominate overwhelmingly — effectively reducing the system to a single-constraint model. Linear weights mean the top constraint is only 7× more influential than the bottom one, preserving meaningful trade-offs.

**Special case — `homeAwayMode: 'strict'` (Amendment 6):** When `homeAwayMode = 'strict'`, the `balance_home_away` soft constraint receives double its computed weight:

```
if input.homeAwayMode === 'strict' && constraintId === 'balance_home_away':
  effectiveWeight = weight * 2
```

### 7.4 Disabled Constraints

A `SoftConstraintId` not present in `softConstraintPriority` is disabled: its penalty weight is 0. The algorithm treats disabled constraints as satisfied regardless of the slot.

---

## 8. Edge Cases and Error Conditions

| Condition | Behaviour | Output |
|---|---|---|
| Fewer available slots than required fixtures | Partial schedule; unassigned pairings listed with `NO_SLOT_IN_SEASON` reason | `feasible: false`; soft + hard conflicts reported; preview blocks publish |
| Team has no `homeVenueId` | Schedule continues; any available venue used for home games | Soft warning per affected team in `conflicts[]` |
| Venue has 0 available days in the season window | Venue produces no slots; other venues absorb load | Soft warning if venue was a team's home venue; hard conflict if it was the only venue |
| Season too short for `minRestDays` (e.g., 2-day season, 7-day rest) | Pairings fail hard rest check; unassigned | Soft conflicts with `REST_CONFLICT`; `feasible: false` |
| Odd number of teams | Bye team inserted; bye pairings dropped (see §4.2) | `teamStats` for each team shows `byeRounds > 0`; no error |
| Only 2 teams (minimum) | Single fixture (single RR) or 2 fixtures (double RR) | Normal output; may complete in <1ms |
| 20 teams (maximum) | 190 fixtures (single RR); see §9 for performance | Normal output; expected <5s |
| `doubleheader.enabled` but no window is long enough for two games + buffer | No doubleheader slots found; each fixture scheduled individually | Soft warning: `"No doubleheader slots available; scheduled individually"` |
| All venues on blackout for the full season | 0 slots generated | Hard error: `invalid-argument` — `"No available venue slots in season window after blackouts"` (only hard function failure case for scheduling infeasibility) |
| `coachAvailability` references a teamId not in `teams[]` | Entry silently ignored | No error; availability for that team is treated as not submitted |
| `format: double_round_robin` with 20 teams | 380 fixtures | Normal output; see §9 |

### 8.1 Hard Function Errors vs. Partial Schedules

The algorithm returns a hard `invalid-argument` error (before running) only for:
- Input validation failures (§1.2)
- Zero valid slots across all venues (the "all venues blacked out" case above)

Everything else — including infeasible fixture assignments — returns a partial `ScheduleAlgorithmOutput` with `feasible: false`. The wizard surfaces this to the LM in the preview step.

---

## 9. Performance Expectations

### 9.1 Complexity

| Step | Complexity | Notes |
|---|---|---|
| Slot generation | O(D × V × W) | D = days in season, V = venues, W = avg windows/venue |
| Pair generation | O(N²) | N = teams |
| Assignment loop | O(P × S) | P = pairings, S = slots |
| Soft scoring | O(P × S × C) | C = number of active soft constraints (≤ 7) |

For the maximum scale:
- D = 365, V = 10, W ≈ 3 → ~10,950 slots (upper bound; most seasons are shorter)
- P = 190 pairings (20 teams, single RR)
- S = 10,950 slots
- C = 7 soft constraints

Inner loop iterations ≈ 190 × 10,950 × 7 ≈ **14.5 million operations**

All operations are simple arithmetic and map lookups. At typical V8 JS throughput (~100M simple ops/sec), this is well under 1 second.

### 9.2 Maximum Scale Runtime Estimate

| Scenario | Teams | Fixtures | Estimated runtime |
|---|---|---|---|
| Minimum | 2 | 1–2 | < 1 ms |
| Typical | 10 | 45 | < 50 ms |
| Large | 16 | 120 | < 200 ms |
| Maximum (single RR) | 20 | 190 | < 500 ms |
| Maximum (double RR) | 20 | 380 | < 1 s |

### 9.3 Cloud Function Timeout Risk

The new `generateSchedule` function runs with a **300-second timeout** (same as the function it replaces; v2 Cloud Functions cap at 540s). The estimated maximum runtime of < 1 second is four orders of magnitude below the timeout. There is no timeout risk.

Memory usage is also low: slot and state maps for 20 teams / 10,950 slots fit comfortably within a 256 MiB allocation.

**Recommendation:** Set `memory: '256MiB'` and `timeoutSeconds: 60` (conservative headroom while signalling the expected fast execution to Cloud Functions billing).

---

## 10. Cloud Function Interface

### 10.1 Function Name and Signature

```typescript
export const generateSchedule = onCall(
  {
    timeoutSeconds: 60,
    memory: '256MiB',
    // No secrets required — deterministic algorithm, no external API calls
  },
  async (request): Promise<ScheduleAlgorithmOutput> => { ... }
);
```

### 10.1a Deprecation of `generateLeagueSchedule` (Amendment 11)

The old LLM-based `generateLeagueSchedule` function is **deleted** in the same PR that ships `generateSchedule`. Specifically:

- `generateLeagueSchedule` is removed from the Cloud Functions codebase entirely.
- The wizard UI is updated to call `generateSchedule` in the same PR.
- There is **no** disable-then-delete transition period; the two functions must not coexist.
- This deletion eliminates **FINDING-01**, **FINDING-02**, and **FINDING-03** from the security audit.

### 10.2 Auth Requirements

Same ownership-check pattern as current `generateLeagueSchedule`:

```typescript
// 1. Authentication guard
if (!request.auth) {
  throw new HttpsError('unauthenticated', 'Authentication required.');
}

// 2. Role guard (league_manager or admin only)
const role = await assertAdminOrCoach(request.auth.uid);
if (role !== 'admin' && role !== 'league_manager') {
  throw new HttpsError(
    'permission-denied',
    'Only league managers and admins can generate schedules.'
  );
}

// 3. League ownership guard
const league = await db.doc(`leagues/${input.leagueId}`).get();
if (!league.exists) {
  throw new HttpsError('not-found', 'League not found.');
}
if (league.data()!.managedBy !== request.auth.uid && role !== 'admin') {
  throw new HttpsError(
    'permission-denied',
    'You do not manage this league.'
  );
}
```

### 10.3 Input Validation Guard Order

Validation runs in this order before the algorithm starts. The first failure throws immediately.

1. Auth check (unauthenticated → reject)
2. Role check (non-LM/non-admin → reject)
3. Rate limit check (reuse `checkRateLimit` with key `'generateSchedule'`, 5 calls / 60 s)
4. League ownership check
5. Structural validation: required fields present, types correct
6. Domain validation: team count, venue count, date formats, time formats, numeric ranges (§1.2)
7. Referential integrity: `homeVenueId` references, team ID uniqueness, venue ID uniqueness
8. Feasibility pre-check: at least one venue has at least one window day within the season range that is not blacked out; if not, throw `invalid-argument` immediately (do not run the algorithm)
9. §3 Step 0 feasibility pre-check (Amendment 3): raw slot capacity ≥ 50% of required fixtures

**Wizard pre-call responsibility — practice events (Amendment 14):** Before calling `generateSchedule`, the wizard checks whether `avoid_practice_conflicts` is in the LM's enabled soft constraint list. If yes, the wizard queries Firestore (`scheduledEvents` where `type = 'practice'` AND `teamId in enrolledTeams` AND `date between seasonStart and seasonEnd`) and populates `practiceEvents` in the call. If the toggle is off, `practiceEvents` is omitted entirely. The Cloud Function does not fetch practice events itself.

### 10.4 Return Format (Amendment 12)

On success, return `ScheduleAlgorithmOutput` directly to the caller (see §2). The Cloud Function wrapper does not wrap this in an additional envelope.

**No Firestore writes from the Cloud Function.** The function computes and returns the schedule; it does not persist anything to Firestore. Fixtures are written to Firestore by the **client** when the LM explicitly publishes the schedule in the wizard.

> **Backlog note:** Async generation with Firestore draft storage (`leagues/{leagueId}/drafts/{draftId}`) is a long-term backlog item for when schedule generation might approach Cloud Function timeout limits. Under current performance estimates (< 1 s), this is not needed.

On error, throw `HttpsError` with the appropriate gRPC status code:

| Situation | Code |
|---|---|
| Not authenticated | `unauthenticated` |
| Wrong role | `permission-denied` |
| Rate limited | `resource-exhausted` |
| Validation failure | `invalid-argument` |
| League not found | `not-found` |
| Unexpected algorithm error | `internal` |

### 10.5 Required Firestore Rules (Amendment 13)

The following Firestore security rules **must be deployed in the same PR** as the Cloud Function — not in a follow-up PR.

```
match /leagues/{leagueId}/fixtures/{fixtureId} {
  allow read: if request.auth != null;
  allow write: if isAdmin()
    || (isLeagueManager() && getProfile().leagueId == leagueId);
}
match /leagues/{leagueId}/drafts/{draftId} {
  allow read, write: if isAdmin()
    || (isLeagueManager() && getProfile().leagueId == leagueId);
}
match /leagues/{leagueId}/generationStatus/{doc} {
  allow read: if request.auth != null;
  allow write: if false;
}
```

`/drafts/` and `/generationStatus/` rules are included now even though these paths are not yet used, to prevent accidental open writes if they are created as part of exploratory work before the async backlog item is built.

### 10.6 Removal of anthropicKey Secret

Because the new function makes no external API calls, the `anthropicKey` secret must be removed from this function's configuration. The `ANTHROPIC_API_KEY` secret itself is retained if other functions still use it; only the reference in this function's `onCall` options is removed.

---

## Appendix A — Differences from Current ScheduleWizardInput

| Field | Old (`ScheduleWizardInput`) | New (`GenerateScheduleInput`) | Notes |
|---|---|---|---|
| `leagueId`, `leagueName` | Present | Present | Unchanged |
| `teams[].homeVenue` | Venue name string | `teams[].homeVenueId` | ID reference instead of name; enables reliable venue lookup |
| `teams[].earliestKickOff` | Present | Removed | Replaced by venue window constraints |
| `venues[].availableDays[]` | Legacy format | Removed | All venues must use `availabilityWindows` |
| `venues[].availableTimeStart/End` | Legacy format | Removed | Same as above |
| `format` | Includes `single_elimination`, `double_elimination`, `group_then_knockout` | `single_round_robin`, `double_round_robin` only | Elimination formats are out of scope per ADR-005 |
| `groupCount`, `groupAdvance` | Present | Removed | Group format removed from scope |
| `blackoutDates` | Season-wide only | Season-wide + per-venue | Per-venue blackouts now in `venues[].blackoutDates` |
| `softConstraintPriority` | Absent | Present (ordered list) | New in v2 |
| `coachAvailability` | Absent | Present (optional) | New in v2; personal coach schedules only |
| `doubleheader` | Absent | Present (optional) | New in v2; requires `double_round_robin` |
| `homeAwayMode` | Absent | Present (required, default `'relaxed'`) | New in v2 (Amendment 6) |
| `homeVenueEnforcement` | Absent | Present (optional, default `'soft'` when strict) | New in v2 (Amendment 7) |
| `practiceEvents` | Absent | Present (optional, wizard-populated) | New in v2 (Amendment 8); separate from coachAvailability |
| `gamesPerTeam` | Absent | Present (optional) | New in v2 (Amendment 10) |
| Output `summary` | Present (LLM-written) | Present (template-generated) | Format: `"32 of 32 fixtures scheduled across 3 venues. 2 fallback slots used."` |
| Output `warnings` | Absent | Present (array) | New in v2 (Amendment 5); bye round banners etc. |

---

## Appendix B — Glossary

| Term | Definition |
|---|---|
| **Slot** | A specific (date, venue, startTime) combination with available capacity |
| **Pairing** | An unscheduled matchup between two teams with home/away roles assigned |
| **Fixture** | A scheduled pairing (pairing + slot) |
| **Round** | A grouping of pairings from the circle method; one round = one set of games where each team plays at most once |
| **Bye** | A round where a team has no opponent (occurs only with odd team count) |
| **Primary window** | A venue's preferred recurring availability (weekends typically) |
| **Fallback window** | A venue's secondary availability used only when primary cannot fill all fixtures |
| **Doubleheader** | Two fixtures between the same pair of teams on the same day at the same venue |
| **LM** | League Manager — the user who configures and generates the schedule |
| **Feasible** | The algorithm assigned every required fixture; `stats.feasible === true` |
