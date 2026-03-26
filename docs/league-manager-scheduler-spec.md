# League Manager Scheduler — Feature Specification

**Project:** First Whistle Sports Scheduler
**Author:** Business Analyst Agent
**Date:** 2026-03-26
**Status:** Draft

---

## Overview

League managers need the ability to build complete season schedules within the app rather than coordinating via spreadsheets and email. This feature set introduces:

1. **Venue Management** — define venues with availability windows
2. **Blackout Dates** — block out periods when no games can be scheduled
3. **Coach Availability Collection** — structured availability submissions from coaches
4. **Schedule Generation** — draft a schedule that respects all constraints
5. **Schedule Publishing & Notifications** — publish and notify all stakeholders

---

## Roles & Permissions

| Action | Admin | League Manager | Coach | Player/Parent |
|---|---|---|---|---|
| Manage venues | ✅ | ✅ (own leagues) | ❌ | ❌ |
| Manage blackout dates | ✅ | ✅ (own leagues) | ❌ | ❌ |
| Request coach availability | ✅ | ✅ (own leagues) | ❌ | ❌ |
| Submit availability | ❌ | ❌ | ✅ (own teams) | ❌ |
| Generate draft schedule | ✅ | ✅ (own leagues) | ❌ | ❌ |
| Publish schedule | ✅ | ✅ (own leagues) | ❌ | ❌ |
| View published schedule | ✅ | ✅ | ✅ | ✅ |

---

## Feature 1 — Venue Management

### User Stories

- **LM-V1:** As a league manager, I want to add venues to my league so that the scheduler knows where games can be played.
- **LM-V2:** As a league manager, I want to set the available days and time windows for each venue so that the scheduler only assigns games when the venue is available.
- **LM-V3:** As a league manager, I want to set the capacity (number of simultaneous games) for each venue so that double-booking is prevented.
- **LM-V4:** As a league manager, I want to edit or deactivate a venue so that I can reflect real-world changes without losing historical data.

### Acceptance Criteria

- A league manager can create a venue with: name, address, number of fields/courts (capacity), and a weekly availability template (day + start time + end time per slot).
- Multiple time slots per day are supported (e.g. Saturday 09:00–12:00 and 14:00–17:00).
- A venue can be marked **inactive** — it will be excluded from scheduling but retained for history.
- Venues are scoped to a league; a league manager only sees venues in their league(s).
- A venue must have at least one availability slot before it can be used in scheduling.

### Data Model — `venues` collection

```
venues/{venueId}
  leagueId: string
  name: string
  address?: string
  capacity: number                   // simultaneous games/fields
  availabilitySlots: AvailabilitySlot[]
  isActive: boolean
  createdBy: string                  // uid
  createdAt: Timestamp
  updatedAt: Timestamp

AvailabilitySlot {
  dayOfWeek: 0–6                     // 0 = Sunday
  startTime: string                  // "HH:mm" 24h
  endTime: string                    // "HH:mm" 24h
}
```

### UI Components

- `VenuesPage.tsx` — list of venues for the league, with Add/Edit/Deactivate actions
- `VenueFormModal.tsx` — create/edit form with weekly availability slot builder
- `VenueAvailabilityGrid.tsx` — visual weekly grid showing available windows

### Business Rules

- `endTime` must be after `startTime` on the same day.
- Game duration (from `ScheduledEvent.duration`) must fit within a single availability slot.
- Deleting a venue is not allowed if it has published scheduled events assigned to it — deactivate instead.

---

## Feature 2 — Blackout Dates

### User Stories

- **LM-B1:** As a league manager, I want to add blackout date ranges to my league so that no games are scheduled during holidays or facility closures.
- **LM-B2:** As a league manager, I want to apply a blackout to all venues or to a specific venue so that I have flexibility when only one venue is unavailable.
- **LM-B3:** As a league manager, I want to see all blackout periods on a calendar so that I can spot gaps and conflicts at a glance.

### Acceptance Criteria

- A blackout entry has: label (e.g. "Spring Break"), start date, end date, and an optional scope (all venues or a specific venue).
- Blackout dates are inclusive on both ends.
- Single-day blackouts are supported (start date == end date).
- The schedule generator must not place any game on a blackout date for the scoped venues.
- Blackout dates are displayed on the league's calendar view with a distinct visual treatment.
- A league manager can delete a blackout date at any time, including after a draft schedule has been generated (requires re-generation).

### Data Model — `leagueBlackouts` collection

```
leagueBlackouts/{blackoutId}
  leagueId: string
  label: string
  startDate: string                  // "YYYY-MM-DD"
  endDate: string                    // "YYYY-MM-DD"
  venueId?: string                   // null = applies to all venues
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
```

### UI Components

- `BlackoutDatesPanel.tsx` — list + add/delete within `LeagueDetailPage`
- `BlackoutFormModal.tsx` — date range picker + venue selector + label
- Calendar integration: blackout ranges shown as shaded bands in `CalendarPage`

### Business Rules

- Overlapping blackouts are allowed (they simply widen the blocked window).
- A blackout cannot be created with `endDate` before `startDate`.

---

## Feature 3 — Coach Availability Collection

### User Stories

- **LM-C1:** As a league manager, I want to send an availability request to all coaches in my league so that I can collect their constraints before building the schedule.
- **LM-C2:** As a coach, I want to mark specific dates or date ranges as unavailable for my team so that games are not scheduled when we cannot play.
- **LM-C3:** As a coach, I want to indicate preferred game days and times so that the scheduler can optimize for my team when possible.
- **LM-C4:** As a league manager, I want to see a summary of which coaches have responded and what their constraints are so that I can follow up with non-responders.

### Acceptance Criteria

- League manager triggers an **availability request** with a submission deadline and a date window (season start → season end).
- Each coach in the league receives an in-app notification and email prompting them to submit availability.
- The coach availability form allows:
  - Marking individual dates or date ranges as **unavailable** (hard constraint — scheduler must respect)
  - Marking individual dates or date ranges as **preferred** (soft constraint — scheduler optimises for)
  - Selecting preferred days of week (e.g. "prefer Saturdays")
  - Selecting preferred start time ranges (e.g. "prefer 10:00–14:00")
- A coach can update their submission any time before the deadline.
- The league manager sees a response dashboard: coaches listed with status (Not Responded / Submitted / Updated) and a summary of constraints.
- After the deadline, submissions are locked unless the league manager explicitly re-opens the window.

### Data Model

```
leagueAvailabilityRequests/{requestId}
  leagueId: string
  seasonWindow: { startDate: string, endDate: string }
  deadline: string                   // "YYYY-MM-DD"
  status: 'open' | 'closed'
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp

coachAvailability/{leagueId}_{teamId}
  leagueId: string
  teamId: string
  coachId: string                    // uid
  requestId: string
  unavailableDates: DateRange[]      // hard constraints
  preferredDates: DateRange[]        // soft constraints
  preferredDaysOfWeek: number[]      // 0–6
  preferredTimeWindow?: { startTime: string, endTime: string }
  submittedAt?: Timestamp
  updatedAt: Timestamp

DateRange {
  startDate: string                  // "YYYY-MM-DD"
  endDate: string                    // "YYYY-MM-DD"
  note?: string
}
```

### UI Components

- `AvailabilityRequestPanel.tsx` — league manager view: create request, view response summary, re-open window
- `CoachAvailabilityForm.tsx` — coach view: interactive calendar to mark unavailable/preferred dates, day-of-week checkboxes, time window picker
- `AvailabilityResponseDashboard.tsx` — league manager table of all coaches, response status, constraint summary
- In-app notification: new `NotificationType` value `'availability_request'`

### Business Rules

- Only one active availability request per league at a time.
- A coach can only submit availability for teams they are the coach of.
- Unavailable date ranges that overlap with blackout dates are redundant but accepted (no error).
- If a coach has not responded by the deadline, the scheduler treats them as having no constraints (fully available).

---

## Feature 4 — Schedule Generation

### User Stories

- **LM-G1:** As a league manager, I want to generate a draft schedule for my league so that I have a complete fixture list to review before publishing.
- **LM-G2:** As a league manager, I want the generator to respect venue availability, blackout dates, and coach hard constraints so that the schedule is immediately workable.
- **LM-G3:** As a league manager, I want the generator to optimise for coach soft preferences so that coaches are satisfied where possible.
- **LM-G4:** As a league manager, I want to manually adjust individual games in the draft before publishing so that I can handle edge cases.
- **LM-G5:** As a league manager, I want to regenerate the schedule if I change constraints so that I can iterate toward a good schedule.

### Acceptance Criteria

- The league manager sets generation parameters: season start date, season end date, game duration (minutes), number of rounds (home & away or one-way), and gap between games per team (minimum days).
- The generator produces a set of `ScheduledEvent` records in **draft** status (new `EventStatus` value: `'draft'`).
- Generation rules (in priority order):
  1. **Hard — Blackout dates:** No game on a blacked-out date/venue.
  2. **Hard — Venue availability:** Game must fall within a venue's available slot and not exceed venue capacity.
  3. **Hard — Coach unavailability:** Neither team's coach has marked the date unavailable.
  4. **Hard — Team rest gap:** A team cannot play two games within the minimum gap.
  5. **Soft — Coach preferences:** Prefer dates/times/days marked as preferred by both teams' coaches.
  6. **Soft — Home/away balance:** Teams should alternate home and away games evenly.
- If a complete schedule cannot be generated (constraint conflict), the generator reports which games could not be placed and why.
- Draft events are only visible to league managers and admins — not to coaches or players until published.
- The league manager can drag-and-drop or edit individual draft events via the existing `EventForm` modal.
- Regeneration deletes all existing draft events for the league and creates new ones.

### Data Model Changes

- `EventStatus` gains a new value: `'draft'`
- `ScheduledEvent` gains new fields:
  ```
  scheduleId?: string        // links to the leagueSchedule that generated it
  venueId?: string           // resolved venue (links to venues collection)
  isDraft?: boolean          // true until published
  ```
- New collection:

```
leagueSchedules/{scheduleId}
  leagueId: string
  status: 'draft' | 'published' | 'archived'
  parameters: ScheduleParameters
  generatedAt: Timestamp
  publishedAt?: Timestamp
  createdBy: string

ScheduleParameters {
  seasonStart: string
  seasonEnd: string
  gameDurationMinutes: number
  rounds: number
  minGapDays: number
}
```

### UI Components

- `ScheduleGeneratorPanel.tsx` — parameter form + Generate button + conflict report
- `DraftScheduleView.tsx` — calendar/list view of draft events with edit controls
- `ScheduleConflictReport.tsx` — lists unplaced games with reason codes

### Business Rules

- Only one schedule per league can be in `'draft'` state at a time.
- Editing a draft event does not trigger regeneration.
- A previously published schedule is moved to `'archived'` when a new one is published.

---

## Feature 5 — Schedule Publishing & Notifications

### User Stories

- **LM-P1:** As a league manager, I want to publish the draft schedule so that all coaches and players can see their fixtures.
- **LM-P2:** As a league manager, I want coaches to be notified when the schedule is published so that they are aware without checking the app.
- **LM-P3:** As a coach, I want to see all my team's games in the calendar immediately after publish so that I can plan accordingly.
- **LM-P4:** As a league manager, I want to unpublish a schedule and return it to draft if significant changes are needed so that I can correct errors before re-publishing.

### Acceptance Criteria

- Publish action: all `'draft'` events for the schedule are updated to `'scheduled'` status atomically.
- On publish, an in-app notification is sent to every coach and admin in the league.
- On publish, an email notification is sent to every coach email in the league (via existing `onNotificationCreated` Cloud Function trigger).
- Published events appear immediately in `CalendarPage`, `EventsPage`, and team detail views for all league members.
- Unpublish action: all `'scheduled'` events for the schedule are reverted to `'draft'`; a notification is sent informing coaches the schedule has been retracted.
- After publishing, individual events can still be edited or cancelled using existing event management — those changes trigger the existing notification flows.

### Data Model Changes

- `leagueSchedules.status` transitions: `draft → published → archived`
- New `NotificationType` values: `'schedule_published'`, `'schedule_retracted'`

### UI Components

- **Publish / Unpublish button** in `ScheduleGeneratorPanel` or `LeagueDetailPage`
- Notification card for `schedule_published` / `schedule_retracted` in `NotificationsPage`

### Business Rules

- A schedule cannot be published if it has zero draft events.
- Publishing is an atomic Firestore batch write — either all events update or none do.
- Only one schedule per league can be in `'published'` state at a time; publishing a new draft archives the previous published schedule.

---

## Implementation Phases

| Phase | Features | Notes |
|---|---|---|
| 1 | Venue Management + Blackout Dates | Foundation — no deps on other features |
| 2 | Coach Availability Collection | Depends on Phase 1 (season window) |
| 3 | Schedule Generation | Depends on Phases 1 & 2 |
| 4 | Publishing & Notifications | Depends on Phase 3 |

---

## Open Questions

1. **Home venue assignment:** Should teams have a "home venue" auto-assigned from the venues list, or should the league manager assign venues per game?
2. **Tie-breaking in generator:** When multiple slots satisfy all constraints equally, what is the preferred tie-break (earliest date? balanced home/away first?)?
3. **Tournament support:** Are round-robin and elimination bracket formats in scope for the first release?
4. **Bye weeks:** If a league has an odd number of teams, should the generator automatically insert bye weeks?
5. **Player-visible availability:** Should players/parents also be able to indicate availability, or is that out of scope?
