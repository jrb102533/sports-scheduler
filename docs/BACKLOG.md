# First Whistle — Prioritised Backlog
**Last updated:** 2026-04-23
**Status key:** 🟢 In Progress · 🔵 Ready · ⚪ Parked · ✅ Done

---

## Currently In Progress

### 🟢 Venue Management — Merge Remaining Branches
**Branch:** `feature/venues-2026-03-28`
**GitHub issue:** See label `venue-management`

Four sub-branches built and pushed; `feat/venues-foundation` already merged. Remaining:
- `feat/venues-page` — full `/venues` CRUD page
- `feat/venues-functions` — `geocodeVenueAddress` Cloud Function
- `feat/venues-wizard` — VenueCombobox in wizard Step 2
- `feat/venues-event-panel` — "Get directions" link in EventDetailPanel

**Next step:** Merge branches → `npm run build` → fix TS errors → push → open PR.

---

### 🟢 Schedule Wizard — Algorithm Redesign (spec first)
**Decision:** Replace LLM `generateLeagueSchedule` Cloud Function with deterministic constraint-satisfaction algorithm. All design decisions locked (see ADR-005 and session checkpoint).
**Next step:** Write full algorithm spec before any implementation agents launch.

---

## Architecture — Data Model & Role Access (address before next season is created)

**Epic: FW-53** — all decisions locked 2026-04-24. See ADR-010.

### 🔵 FW-ARCH-01 — Move `wizardDraft` under seasons (P0) · Jira: FW-54
**ADR:** ADR-010 | **Effort:** Small

`leagues/{leagueId}/wizardDraft/draft` is a single document. Starting a Season 2 wizard overwrites a Season 1 draft in progress. Move to `leagues/{leagueId}/seasons/{seasonId}/wizardDraft/draft`. Requires updating all wizard draft read/write paths and a one-time migration of any existing draft documents.

---

### 🔵 FW-ARCH-02 — Move `divisions` under seasons (P1) · Jira: FW-55
**ADR:** ADR-010 | **Effort:** Medium

`leagues/{leagueId}/divisions/{divisionId}` uses a `seasonId` field to associate divisions with seasons. Path-level nesting is the correct structure — security rules can enforce the season boundary by path, subcollection queries are safer, and the `resource.data.*` rule safety hazard is eliminated. Move to `leagues/{leagueId}/seasons/{seasonId}/divisions/{divisionId}`. Required for schedule wizard expansion spec (multi-division, named surfaces).

---

### ✅ FW-ARCH-03 — ~~Add `teamMemberships` subcollection~~ DROPPED
Team-season membership is implicit through `division.teamIds[]`. No separate subcollection needed (decision locked 2026-04-24).

---

### 🔵 FW-ARCH-04 — Move `availabilityCollections` under seasons (P2) · Jira: FW-56
**ADR:** ADR-010 | **Effort:** Small

`leagues/{leagueId}/availabilityCollections/` has no season binding — ambiguous when two seasons are open simultaneously. Move to `leagues/{leagueId}/seasons/{seasonId}/availabilityCollections/`. Drop the redundant `leagueId` field from the document.

---

### 🔵 FW-ARCH-05 — Coach role access in league/season views (P1) · Jira: FW-57
**Research:** 2026-04-23 UX + architect review | **Effort:** Medium

**Problem:** Coaches can navigate into the LM's season management dashboard and see setup checklists, FeasibilityPanel, and Generate Schedule CTAs — controls that are meaningless or confusing for a coach.

**Immediate P0 fix (2 hours):** Wrap the "Regular Season" setup section, FeasibilityPanel, and Generate Schedule CTA block in `canManage` guards in `SeasonDashboard`. Stops the bleeding without architectural change.

**Full fix (P1):** Implement `CoachSeasonView` — a separate component rendered by `SeasonDashboard` when `!canManage`. Contains:
1. Season name + date range + status badge
2. "Your Upcoming Games" — fixtures filtered to their team only
3. Division standings for their division
4. "Submit Availability" CTA if an active collection exists

**Bonus bug:** `LeaguesPage.visibleLeagues` filters to leagues the user *manages* — coaches who are members of a league see zero leagues on the Leagues page. Fix in the same pass.

**Product decision required:** The "Add Event" button in the league view is currently allowed for coaches via `RoleGuard`. Decision needed before PR: keep it (coaches can add league-level events) or remove it (coaches manage events through their team page only). UX recommends removing it.

---

## Priority 0 — Security (address before next public feature)

| ID | Finding | Severity | Notes |
|---|---|---|---|
| SEC-01 | No league ownership check in `generateLeagueSchedule` | HIGH | Eliminated by algorithm sprint |
| SEC-02 | No input size bounds — unbounded API cost | HIGH | Eliminated by algorithm sprint |
| SEC-03 | Per-UID rate limit bypassed by account rotation | HIGH | Mitigated by algorithm sprint; global rate limit still needed |
| SEC-08 | HMAC bypass when secret is empty string | MEDIUM | Quick fix — independent of algorithm sprint |
| SEC-13 | XSS via unsanitized `playerName`/`teamName` in `sendInvite` HTML | LOW | Quick fix |
| SEC-14 | RSVP reminder/follow-up links missing HMAC tokens | LOW | Fix before HMAC secret is provisioned |
| SEC-16 | Any authenticated user can delete team logos | LOW | Requires Firebase Auth Custom Claims |

*Full audit: `.claude/security-audit-schedule-wizard-2026-03-28.md`. GitHub Issues: label `security`.*

---

## Priority 0.5 — Phase B PRs (branches built, need PRs opened)

- `feat/phase-b-coach-availability-form`
- `feat/phase-b-wire-availability-generator`
- `feat/phase-b-fallback-preview`
- `feat/phase-b-season-recommendation`
- `chore/td-004-lazy-load-xlsx`

**Action:** Open PRs for each; merge in order: td-004 → wire-generator → coach-form → fallback-preview → season-recommendation.

---

## Priority 1 — High Value, High Attraction

Ship before marketing push.

### 🔵 Admin Console — User Management Completeness
**Users:** Admin | **Effort:** Medium | **Spec:** PRD §8

Ensure admins can perform all required user management operations from the app without needing Firebase Console access. Required before onboarding external organisations.

**Features required (in priority order):**

#### Last Login Date on Users Page (P1)
- `getLastLoginDates` callable Cloud Function reads `lastSignInTime` for all UIDs via Admin SDK
- Users page displays last login as relative time ("3 days ago") with full datetime on hover
- Required to identify inactive accounts and troubleshoot access issues
- Admin-only; no other role can see this data

#### Disable / Suspend User (P1)
- Admin can revoke a user's access without deleting their account
- Sets `disabled: true` in Firebase Auth via Cloud Function
- Disabled users are shown with a visual indicator on the Users page
- Admin can re-enable

#### Force Password Reset (P2)
- Admin can trigger a password reset email for any user
- Uses Firebase Auth `generatePasswordResetLink` via Admin SDK

#### Delete User (P2)
- Permanent removal from Firebase Auth + Firestore user document
- Requires confirmation dialog
- Cascading cleanup: remove from team rosters, memberships

---

### 🔵 Player Availability Window (BA-F03)
**Users:** Coach, Player | **Effort:** Medium | **Spec:** `ba-feature-specs-2026-03-24.md` §F3

Players mark date ranges as unavailable; coach sees conflicts when scheduling. Availability heatmap per player. Directly reduces #1 coach pain point (attendance uncertainty) and gives players agency.

**Key requirements:**
- Players/parents submit unavailability windows (start, end, optional reason)
- Coach sees conflicts when scheduling new events
- Availability heatmap across a selected date range

---

### 🔵 Post-Game Summary & Result Broadcast (BA-F04)
**Users:** Coach, Player, Parent | **Effort:** Small | **Spec:** `ba-feature-specs-2026-03-24.md` §F4

After recording a result, coach can write a short post-game note and broadcast it (in-app + email) in one action. Man of the Match callout. High-frequency touchpoint — every game is a moment.

---

### 🔵 "This Week in Sport" Weekly Digest (BA-RH1)
**Users:** All | **Effort:** Small (Cloud Function + email)

Weekly push/email (Monday morning) summarising the week ahead per user. Coaches see non-responders. Highest ROI retention mechanic — creates weekly re-engagement without requiring app open.

---

### 🔵 Rollover Markup & Tooltips
**Users:** All | **Effort:** Medium | **Spec:** PRD §10

Add consistent hover tooltips and `aria-label` attributes across all interactive elements. Required for accessibility compliance and UX quality before external launch.

**Priority order:**
1. Icon-only buttons — `aria-label` + tooltip showing full action name
2. Relative timestamps — full datetime on hover ("Wed 9 Apr 2026, 14:32")
3. Disabled button states — tooltip explaining why unavailable
4. Navigation icons when sidebar is collapsed
5. Status badges / colour indicators

**Implementation:** Shared `<Tooltip>` component (Radix UI `@radix-ui/react-tooltip`). `title` attributes alone are not sufficient — do not use as a substitute.

---

### 🔵 SEO Optimisation
**Users:** Public / prospective users | **Effort:** Small (v1), Medium (v2) | **Spec:** PRD §11

**v1 (ship now):** `react-helmet-async` for dynamic `<title>` and meta tags on all public pages. `robots.txt` disallowing authenticated routes. `sitemap.xml` covering public pages. Static OG image (1200×630). JSON-LD `SoftwareApplication` schema on landing page.

**v2 (next sprint):** Prerender middleware via Firebase Function for full crawler indexing of JS-rendered public pages.

**v3 (future):** SSR/SSG — out of scope until product-market fit confirmed.

---

### 🔵 Weather Alerts for Outdoor Events (BA-F09)
**Users:** Coach, Parent, Player | **Effort:** Small

Open-Meteo API (free). Alert coach 24h before outdoor event if rain probability > 70%. One-tap cancel/confirm. Coach decision broadcasted to team via existing notification channels.

*Note: Venue lat/lng is now available from the venue management sprint — can use it directly.*

---

### 🔵 Game & Practice Reminder Emails
**Users:** Coach, Player, Parent | **Effort:** Small | **Spec:** PRD §7.3

Automated pre-event reminder emails sent 24h and 1h before every game or practice. One-tap RSVP link included (HMAC-signed, no login required) using the existing email RSVP pattern. Directly addresses the #1 parent pain point: schedule uncertainty and missed schedule changes.

**Key requirements:**
- Scheduled Cloud Function (`sendEventReminders`) runs every 15 minutes; queries events in next 24–25h and 1–1.25h windows
- Recipients: coach + all active players/parents on the team
- Content: event type, title, date/time, location, opponent (games only), one-tap RSVP buttons
- Dedup guard: `events/{id}/remindersSent/{uid}_{window}` record written before send; prevents duplicate sends on CF retries
- Suppression: cancelled events, past events, opted-out users, teams with reminders disabled, already-sent records
- Uses existing `buildEmail()` branded template + `rsvpButtonsHtml()` — no new email infrastructure required
- Per-user opt-out in notification preferences; per-team disable toggle in team settings (coach only)

**CF pattern:** Same HMAC-signed one-tap RSVP link as existing RSVP emails — no new auth flow needed.

**Out of scope (v1):** SMS reminders (blocked on TD-002), push notifications, per-event customisation.

---

## Priority 2 — High Value, Moderate Effort

### 🔵 Milestone Moments (BA-RH2)
**Users:** All | **Effort:** Small

Automated recognition computed from existing data: "Your team just played their 20th game," "Jamie hasn't missed a session in 8 weeks." Dismissible home screen banner. No user action required — pure delight. Strongest for parents.

---

### 🔵 Streak Indicators for Players (BA-RH3)
**Users:** Player, Parent | **Effort:** Small

Consecutive events attended shown on player profile. Visible to player, parent, optionally coach. Classic engagement mechanic.

---

### 🔵 Substitute / Guest Player Request (BA-F11)
**Users:** Coach | **Effort:** Small

One-off event invite to a non-roster user. Guest RSVP-capable; clearly marked "guest" in attendance; no team data access; archived after event; optional promotion to full roster member.

---

### 🔵 Unified Parent Dashboard / Multi-Child View (BA-F02)
**Users:** Parent | **Effort:** Medium

Single dashboard aggregating all linked children's events in chronological order. Colour-coded by child. Inline RSVP. Conflict highlighting for overlapping events.

---

### 🔵 Event Check-In via QR Code (BA-F07)
**Users:** Coach, Player | **Effort:** Small

Coach generates time-limited QR code; players scan to self-check-in (deep-link, no app required for scan). Live check-in count. Default 30-minute expiry after event start.

---

## Priority 3 — Differentiation / Premium Candidates

### 🔵 In-Season Player & Team Stats — *Premium tier*
**Users:** Coach, Player, Parent | **Effort:** Large

Per-game stat entry (sport-configurable: goals, assists, saves, etc.). Season aggregates. Leaderboard within team. Shareable per-player stat cards. Free: attendance stats only. Paid: full stats + export.

---

### 🔵 Season Summary & Statistics (BA-F06) — *Premium candidate*
**Users:** Coach, Player, Parent | **Effort:** Medium

Auto-generated at season close. Free: basic totals. Paid: per-player breakdown + export + shareable social card. Natural seasonal upsell moment. Pairs with In-Season Stats.

---

### 🔵 Post-Season "Year in Review" (BA-RH5)
**Users:** All | **Effort:** Medium

Spotify Wrapped-style scrollable in-app story at season end. Most attended event, biggest win, most active player. Once-a-year word-of-mouth generator. Pairs with Season Summary.

---

### 🔵 Carpool Coordination (BA-F05)
**Users:** Parent, Coach | **Effort:** Medium

Parents offer or request seats for specific events. Match summary visible to all parents. In-app messaging to confirm. No address sharing. Solves a high-frequency youth sport pain point.

---

### 🔵 Drill & Session Planner (BA-F08) — *Premium candidate*
**Users:** Coach | **Effort:** Large

Structured session plans attached to practice events (warm-up/drills/cool-down). Each drill: title, duration, description, optional diagram. Personal drill library. Free: 10 saved drills. Paid: unlimited + image upload + assistant coach sharing. Highest lock-in of any feature.

---

### 🔵 GameChanger Integration
**Users:** Coach, League Manager | **Effort:** Medium (feasibility TBD)

Import teams, rosters, schedules from GameChanger. Read-only pull. Target: baseball/softball primarily. *Flag: GameChanger API not publicly documented — confirm feasibility before scoping.*

---

### 🔵 Team Photo & Media Gallery (BA-F10) — *Premium candidate*
**Users:** Parent, Player, Coach | **Effort:** Medium

Per-event photo uploads. Team-level gallery. Coach pins cover photo. 100 MB free / higher cap on paid tier. Strong parental emotional attachment → upgrade driver.

---

## Priority 4 — Infrastructure / Quality

### 🔵 TD-006 — Email quota: scale Brevo plan + sharded counter
**Trigger:** When daily send volume consistently approaches 240 emails/day (80% of current 300/day free-tier limit).

Two actions required together:
1. **Upgrade Brevo plan** — Free tier caps at 300/day. Starter (~$25/mo) gives 20k/month (~645/day). Essential gives 60k/month. Match plan to expected volume before the limit blocks real sends.
2. **Shard the Firestore quota counter** — The current `system/emailQuota_{date}` single-document counter has a Firestore write limit of ~1 write/second. At current soft-launch volume this is fine, but at 100+ concurrent sends it will create write contention. Replace with a sharded counter (N documents, random shard pick, aggregate on read) or switch to a Cloud Tasks queue with rate limiting.

**Current implementation:** `functions/src/index.ts` — `checkEmailQuota()` helper; warns at 240/day (console.error → Cloud Logging alert), blocks at 285/day. Cleanup CF `cleanupEmailQuota` runs weekly.

### 🔵 TD-002 — SMS via Twilio
**Blocked by:** Twilio credentials (PM action: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)
Cloud Function already written (`sendSms`). Feature flag: `VITE_FEATURE_SMS=false`.

### 🔵 TD-005 — Stray backslash/whitespace artifact
No source code cause found. Likely in Firestore data. **Next steps:** Check `demoData.ts` and Firestore documents for `\ ` in title/location/notes fields.

### 🔵 FIREBASE_TOKEN GitHub Secret
**PM action required:** Add token to GitHub repo secrets to enable automated CI/CD deploys on merge to main.

### 🔵 Schedule Wizard — Phase C (In-Season Modification)
Parked until Phase B fully merged. Entry point: Event Detail → Reschedule. Uses archived availability data to find valid replacement slots.

### 🔵 Schedule Wizard — Phase D (Re-run / Diff Compare)
Parked. Preserve prior generation; side-by-side diff in preview step.

---

## Parked

### ⚪ BA Business Plan & Subscription Tiers
Pricing model, tier design (Free / Club / Pro), go-to-market strategy. **Parked until feature set is closer to complete.**

### ⚪ Mobile App (React Native / Flutter)
Parked. Test responsive web first. See ADR-007.

### ⚪ Coach Availability "Preferred" Slots
PM decision: complexity not worth value yet.

### ⚪ Email RSVP Without App Account
Magic-link RSVP for coaches/parents without accounts.

### ⚪ Tournament Entity (full implementation)
Tournament as top-level entity, team import from leagues, group+knockout scheduling.

### ⚪ Team Member Pool + Participation Roster (full implementation)
Persistent member pool with per-enrollment participation rosters.

### ⚪ Team Ownership Model
Ownership transfer, co-owner, billing integration.

### ⚪ League/Tournament Invitation Flow (external teams)
External team invitations with 7-day cooldown, 3 max, 14-day expiry.

### ⚪ Coach Assignment Phase 2–4
Phase 2: typeahead combobox + invite fallback. Phase 3: safe reassignment via Cloud Function. Phase 4: bulk CSV import (premium).

---

## Completed

See historical backlog in `.claude/worktrees/agent-a424fcce/.claude/backlog-2026-03-24.md` for full completed list.

**Recent completions (2026-03-28 session):**
- ✅ Schedule Wizard Phase A (mode picker, preferences, practice mode, venue windows, fallback preview, season recommendation, availability form wiring)
- ✅ Venue Management Phase 1 (foundation, CRUD page, geocoding Cloud Function, wizard integration, event panel directions link)
- ✅ TD-004 — Lazy-load xlsx (branch pushed, pending merge)
