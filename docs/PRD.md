# First Whistle — Product Requirements Document
**Version:** 1.1
**Last updated:** 2026-04-03
**Owner:** Product Manager
**Status:** Living document — updated as features are prioritised

---

## 1. Product Overview

**First Whistle** is a sports league and team scheduling web application for youth and amateur sport. It is a multi-role platform serving five user types: Admins, League Managers, Coaches, Players, and Parents.

The core value proposition is a single-pane-of-glass that handles scheduling, roster management, communication, attendance, and results — eliminating the fragmentation of spreadsheets, group chats, and separate tools that characterises youth sport administration today.

**Primary URL:** https://first-whistle-e76f4.web.app
**Repository:** https://github.com/jrb102533/sports-scheduler
**Tech stack summary:** React 19 + TypeScript, Firebase (Firestore, Auth, Functions, Hosting), Tailwind CSS v4, Zustand v5

---

## 2. Target Users & Pain Points

### Coaches
1. Communication overhead — chasing RSVPs, sending reminders, re-communicating missed messages
2. Attendance uncertainty going into game day
3. Fragmented admin across scheduling, roster, attendance, results, and messaging tools

**First Whistle differentiator:** Single home screen that surfaces who is coming, who hasn't responded, and what action is needed next.

### Players
1. Passive experience — schedule is pushed at them, no agency
2. Lack of personal context in generic schedules
3. Clunky RSVP flows requiring full app login

**First Whistle differentiator:** Player-centric home screen showing "your next event," RSVP status, and pending actions.

### Parents
1. Schedule uncertainty — cancellations and rescheduling happen without timely notice
2. Multi-child complexity — juggling multiple teams, apps, and group chats
3. No visibility into their child's RSVP or attendance status

**First Whistle differentiator:** Unified parent dashboard aggregating all children's teams with clear action indicators.

### League Managers
1. Scheduling conflicts across teams — manual round-robin scheduling is error-prone
2. Standings and results visibility — chasing coaches for results
3. No clean channel for league-wide vs team-level communications

**First Whistle differentiator:** Automated standings tied to result entry; dedicated league-wide announcement channel; wizard-driven schedule generation.

---

## 3. User Roles & Permissions

| Role | Key Capabilities |
|---|---|
| **Admin** | Full platform access; creates users with temp passwords; platform-wide messaging |
| **League Manager** | Creates/manages leagues; runs schedule wizard; views standings; league-wide messaging |
| **Coach** | Manages team roster; creates events; records results and attendance; team messaging |
| **Player** | Views schedule; RSVPs; views own attendance; receives notifications |
| **Parent** | Views child's schedule; RSVPs on behalf of child; receives notifications |

Roles are multi-tenanted: a user can hold multiple roles across multiple teams and leagues.

---

## 4. Feature Inventory

### 4.1 Shipped Features

| Feature | Description |
|---|---|
| Auth & Roles | Email/password auth, email verification, forced first-login password change, role picker, multi-role support |
| Legal Consent | Signup checkbox, re-consent modal, COPPA attestation, Privacy Centre, legal document versioning |
| Dashboard | Role-aware home; Smart Attendance Forecast card; Coach "Next Action" card; Upcoming events |
| League Management | League CRUD; standings (auto-updated from results); league-wide messaging |
| Team Management | Team CRUD; roster management; join/invite flow; guest players; age groups/divisions |
| Event Management | Calendar view; event create/edit (series, tournament, duration); RSVP; result entry & broadcast; snack volunteer; import from xlsx |
| Attendance Tracking | Attendance marking; RSVP pre-populate; configurable warning thresholds |
| Absence & Injury | Coach marks players injured/suspended with expected return date; private notes; roster flag |
| Messaging | In-app messaging; email via SMTP Cloud Function; notification panel |
| Notifications | In-app; email on Firestore trigger |
| Admin | User creation with temp password; platform-wide messaging |
| Schedule Wizard | Multi-mode picker (Season, Practice, Playoff, Tournament, Modify); Phase A+B complete (see §5) |
| Venue Management | Persistent venue library with CRUD; geocoding via Nominatim; directions link in event panel; wizard integration |
| Profile & Settings | Profile page; role editor; context switcher (multi-league/team) |

### 4.2 Shipped — Phase Tracking

| Component | Status |
|---|---|
| Schedule Wizard Phase A (mode picker, preferences, practice mode, recurring venue windows) | ✅ Shipped |
| Schedule Wizard Phase B (availability collection, wizard draft persistence, heatmap) | ✅ Shipped (branches pushed, pending merge) |
| Venue Management Phase 1 (CRUD, geocoding, wizard integration, event panel) | ✅ Shipped (branches pushed, pending merge) |
| Coach Assignment Phase 1 (auto-assign on team creation) | ✅ Shipped |

---

## 5. Schedule Wizard — Detailed Requirements

The Schedule Wizard is the flagship feature for League Managers. It generates conflict-free season, practice, playoff, and tournament schedules.

### 5.1 Modes

| Mode | Description |
|---|---|
| Season | Full round-robin or group+knockout schedule; requires availability collection |
| Practice | Recurring practice sessions for one or more teams |
| Playoff | Single/double elimination or Swiss bracket from seeded teams |
| Tournament | Group stage + knockout, multi-day |
| Modify | Reschedule or swap existing fixtures in-season |

### 5.2 Season Mode Step Sequence
`mode → config → venues → preferences → availability → generate → preview → publish`

### 5.3 Scheduling Engine — Decision Locked
The LLM-based `generateLeagueSchedule` Cloud Function is being replaced with a **deterministic constraint-satisfaction algorithm**. See ADR-005.

- Engine: deterministic (no LLM)
- Format: partial round-robin (all pairs play at least once where game count allows)
- Hard constraints: venue availability, blackouts, no same-day double-booking
- Soft constraints (LM-prioritizable): min rest, max consecutive away, home/away balance, even spacing
- Scale: 4–20 teams, 8–30 games per team
- Home venue: `homeVenueId` per team per league enrollment
- Doubleheaders: opt-in; same venue, alternate home/away; configurable buffer (including 0)
- Rescheduling: regenerate (now); single-fixture patch (Phase C backlog)

### 5.4 Implementation Phases

| Phase | Status |
|---|---|
| Phase A — Mode picker, preferences, practice mode, venue windows | ✅ Complete |
| Phase B — Availability collection, wizard draft, heatmap, season recommendation | ✅ Branches pushed, pending merge |
| Phase C — In-season modification wizard | Backlog |
| Phase D — Re-run / diff compare | Backlog |
| Algorithm redesign — Replace LLM with deterministic CSP | Next sprint — spec to be written first |

---

## 6. Venue Management — Requirements

Venues are first-class persistent entities (not ad-hoc strings on events).

| Requirement | Detail |
|---|---|
| Venue library | CRUD page at `/venues`; MapPin in sidebar |
| Fields | Name, address, lat/lng (geocoded), pitches/courts, recurring availability windows, blackout dates |
| Geocoding | Automatic on save via Nominatim (OpenStreetMap); free, no API key required |
| Wizard integration | Step 2 replaced with VenueCombobox + QuickCreateVenueModal |
| Event panel | "Get directions" link when event.venueId has lat/lng |
| Weather alerts | `checkWeatherAlerts` Cloud Function updated to use venue lat/lng |

---

## 7. Calendar Integration Features

Two separate features extending First Whistle's event model to interoperate with external calendar applications (Apple Calendar, Google Calendar, Outlook).

---

### 7.1 Calendar Sync — Export & Live Updates

**Summary:** Subscribers (parents, players, coaches) can subscribe to a team or league schedule via a live calendar feed. Events appear in their native calendar app and update automatically when the schedule changes.

**User story:** As a parent, I want my child's game schedule to appear in my iPhone Calendar and stay current, so I never miss a reschedule or cancellation.

**Mechanism: iCalendar feed (iCal/ICS)**
- Each team exposes a unique, authenticated calendar feed URL: `/api/calendar/{teamId}?token={calToken}`
- Feed is generated on-demand as a valid `.ics` file (RFC 5545)
- Native calendar apps poll the feed on their own schedule (Apple: typically every few hours; Google: ~24h)
- No push mechanism required — polling is standard for calendar subscriptions

**Scope:**
| Item | Detail |
|---|---|
| Feed URL | Unique per team; includes a signed token tied to the subscriber's UID |
| Event fields | Title, start/end datetime, location (venue name + address), description (event notes), status (CANCELLED maps to `STATUS:CANCELLED` in iCal) |
| Update propagation | Reschedules, cancellations, and location changes reflected immediately on next poll |
| Access control | Token validated server-side; revocable; parent/player scope limited to their team(s) |
| Cancellations | Cancelled events remain in the feed with `STATUS:CANCELLED` so native apps show them struck-through |
| Subscribe UX | "Add to Calendar" button on team detail page and parent home; copies feed URL or opens `webcal://` deep link |
| Supported apps | Any app supporting the iCal subscription standard: Apple Calendar, Google Calendar, Outlook, Fantastical |

**Out of scope (v1):**
- Google Calendar API write-back (push sync)
- Per-event one-click `.ics` download (separate, simpler feature — add to backlog)
- Outlook OAuth integration

**Cloud Function:** `getCalendarFeed` — HTTP function (not callable); returns `Content-Type: text/calendar`

**Priority:** P1 — high parent/player value, relatively low implementation complexity

---

### 7.2 Calendar Import — Coach Schedule from External Calendar

**Summary:** A coach can import events from an external calendar file (`.ics`) to bulk-create a team schedule, rather than entering games manually one by one.

**User story:** As a coach, I already have my league's game schedule in a Google Calendar or received an `.ics` file from the league. I want to import it directly into First Whistle so my team sees it immediately.

**Mechanism: ICS file upload**
- Coach uploads a `.ics` file from their device (no OAuth; no live connection to external calendar)
- First Whistle parses the file client-side, previews the extracted events, and lets the coach confirm before writing to Firestore
- Each `VEVENT` block maps to a First Whistle event on the selected team

**Import flow:**
1. Coach opens team detail → Schedule tab → "Import from Calendar" button
2. File picker accepts `.ics` files only
3. App parses the file and shows a preview table: title, date, time, location
4. Coach selects which events to import (all selected by default; deselectable)
5. Coach maps the import to a team (pre-filled if on team detail page)
6. Coach confirms → events created in Firestore as draft or published (coach's choice)
7. Success: imported events appear on the Schedule tab

**ICS field mapping:**
| iCal field | First Whistle field |
|---|---|
| `SUMMARY` | Event title |
| `DTSTART` / `DTEND` | Start datetime / end datetime |
| `LOCATION` | Location string (not auto-linked to Venue library in v1) |
| `DESCRIPTION` | Event notes |
| `STATUS:CANCELLED` | Event marked cancelled on import |
| `UID` | Stored as `externalCalUid` for dedup on re-import |

**Deduplication:** On re-import, events with a matching `externalCalUid` are flagged as "already imported" in the preview; coach can skip or overwrite.

**Out of scope (v1):**
- Google Calendar OAuth import (requires OAuth consent screen; backlog)
- Apple Calendar direct connection
- Automatic re-sync / two-way sync (covered by §7.1 for outbound)
- Recurring event series expansion (import first occurrence only; flag series to coach)

**Priority:** P2 — high coach value for onboarding existing schedules; depends on ICS parser library (no new backend required)

---

### 7.3 Game & Practice Reminder Emails

**Summary:** Automated pre-event reminder emails sent 24h and 1h before every game or practice. One-tap RSVP link included (HMAC-signed, no login required) using the existing email RSVP pattern. Directly addresses the #1 parent pain point: schedule uncertainty and missed schedule changes.

**User story:** As a parent, I want to receive an email reminder before my child's game or practice with a one-tap RSVP link, so I never miss a schedule change and can confirm attendance without opening the app.

**Mechanism: Scheduled Cloud Function**

| Requirement | Detail |
|---|---|
| CF name | `sendEventReminders` — scheduled, runs every 15 minutes |
| Windows | Queries events starting in the next 24–25h and 1–1.25h |
| Recipients | Coach + all active players/parents on the team |
| Content | Event type, title, date/time, location, opponent (games only), one-tap RSVP buttons |
| Dedup guard | `events/{id}/remindersSent/{uid}_{window}` written before send; prevents duplicate sends on CF retries |
| Suppression | Cancelled events, past events, opted-out users, teams with reminders disabled, already-sent records |
| Email template | Uses existing `buildEmail()` + `rsvpButtonsHtml()` — no new email infrastructure |
| RSVP link | HMAC-signed one-tap link (same pattern as existing RSVP emails) — no login required |
| Opt-out | Per-user in notification preferences; per-team disable toggle in team settings (coach only) |

**Out of scope (v1):**
- SMS reminders (blocked on TD-002 Twilio credentials)
- Push notifications
- Per-event customisation

**Priority:** P1 — highest parent pain point; reuses all existing email infrastructure

---

See [BACKLOG.md](BACKLOG.md) for the full prioritised backlog.

**Priority 1 (ship before marketing push):**
- Player Availability Window
- Post-Game Summary & Result Broadcast
- "This Week in Sport" weekly digest
- Weather Alerts for Outdoor Events
- **Calendar Sync / iCal feed** (see §7.1)
- **Game & Practice Reminder Emails** (see §7.3)

**Priority 2 (next sprint):**
- **Calendar Import from .ics** (see §7.2)
- **SMS Notifications via Twilio** — `sendSms` Cloud Function already written; blocked on Twilio credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`); settings UI to be added once functional (see TD-002 in BACKLOG.md)
- Milestone Moments (retention hook)
- Streak Indicators for Players
- Substitute / Guest Player Request
- Unified Parent Dashboard / Multi-Child View
- Event Check-In via QR Code

**Premium candidates:**
- In-Season Player & Team Stats
- Season Summary & Statistics
- Drill & Session Planner
- Team Photo & Media Gallery

---

## 8. Non-Functional Requirements

| Requirement | Detail |
|---|---|
| Architecture | 12-factor app methodology (see CLAUDE.md) |
| Auth | Firebase Auth; email verification required; no self-assignable admin role |
| Security | All Cloud Functions gate on `request.auth`; secrets via Firebase `defineSecret`; Firestore rules enforce role-based access |
| Environments | Local (Firebase Emulator), Test (Firebase test project), Production |
| Mobile | PWA-first; responsive web tested before native app investment (see ADR-007) |
| Compliance | COPPA-compliant privacy policy; GDPR/CCPA-aware logging (no PII in INFO logs) |
| Bundle size | Lazy-load heavy dependencies (xlsx via TD-004) |
| Hosting | Firebase Hosting; Spark plan constraints: 360 MB/day transfer |

---

## 9. Email Infrastructure

### Sending
| Field | Value |
|---|---|
| Provider | Brevo (SMTP) |
| From address | `noreply@firstwhistlesports.com` |
| From name | First Whistle |
| Transport | Cloud Function SMTP via `emailTemplate.ts` / `buildEmail()` |

All transactional emails (invites, RSVP links, reminders, score broadcasts) route through this address. Brevo free tier: 300 emails/day — upgrade before scaling beyond a few teams.

### Contact / Support
| Purpose | Address | Notes |
|---|---|---|
| User support | `support@firstwhistlesports.com` | GoDaddy forward → personal Gmail; shown in Settings → About |
| Legal / data deletion | `legal@firstwhistle.com` | GDPR/CCPA deletion requests; shown in Settings → Privacy & Legal; 30-day SLA |

---

## 10. Open Blockers (PM Action Required)

| Item | Action |
|---|---|
| FIREBASE_TOKEN | Add to GitHub repo secrets for automated CI/CD deploys |
| TD-002 — SMS | Twilio account + set secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER |
| ANTHROPIC_API_KEY | Still required until deterministic algorithm ships and replaces LLM function |

---

## 11. Security Posture

A security audit was conducted on 2026-03-28 covering Cloud Functions and Firestore rules. **Overall rating: HIGH risk** due to three findings in the LLM-based schedule generation function (all resolved when the algorithm replaces the LLM function).

See GitHub Issues (label: `security`) for full finding list and remediation status.

Key findings prior to algorithm replacement:
- FINDING-01 (HIGH): No league ownership check in `generateLeagueSchedule`
- FINDING-02 (HIGH): No input size bounds — unbounded API cost exposure
- FINDING-03 (HIGH): Per-UID rate limit bypassed by account rotation

These three HIGH findings are eliminated when the LLM function is removed (algorithm sprint).

---

## 12. Mobile Strategy

Parked. Decision: test responsive web first before investing in native app. See ADR-007 and project memory for full context.

---

*This document is maintained by the Product Manager. Architectural decisions are recorded in `docs/adr/`. Implementation detail lives in `.claude/` feature specs.*
