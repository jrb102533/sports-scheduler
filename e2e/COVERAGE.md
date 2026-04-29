# E2E Coverage Matrix

**Last updated:** 2026-04-27 (Phase 2, issue #466)

This document tracks which `@emu` emulator specs cover each role × domain
bucket cell, and documents tests that cannot run in CI (manual checklist only).

---

## Emulator spec inventory

| File | Bucket tags | Tests |
|------|-------------|-------|
| `emulator/login.emu.spec.ts` | `@auth` | Login form renders; unauthenticated redirect; seeded admin sign-in |
| `emulator/auth.emu.spec.ts` | `@auth` | Wrong-password error message |
| `emulator/auth-logout.emu.spec.ts` | `@auth` | Logout via profile page; protected route redirect; signup form fields; /invite/league gate |
| `emulator/invite-flow.emu.spec.ts` | `@auth` | Signup form renders; /invite/league unauthenticated redirect; authenticated access |
| `emulator/invite-signup-allowlist.emu.spec.ts` | `@auth` | Allowlist bypass via invite secret |
| `emulator/profile.emu.spec.ts` | `@auth` | Profile page loads for admin |
| `emulator/add-player.emu.spec.ts` | `@teams` | Admin adds a player to seeded team |
| `emulator/add-team-to-league.emu.spec.ts` | `@teams @leagues` | LM adds team to league |
| `emulator/coach-role.emu.spec.ts` | `@teams` | COACH-ROLE-01–09: routing, home, team tabs, /users block, Manage Users hidden, /teams list, profile badge |
| `emulator/coach.emu.spec.ts` | `@teams` | (pre-existing, team-scoped coach flows) |
| `emulator/admin.emu.spec.ts` | `@teams` | (pre-existing admin smoke) |
| `emulator/createLeague.emu.spec.ts` | `@leagues` | LM creates a league |
| `emulator/cross-role-visibility.emu.spec.ts` | `@leagues` | CROSS-01–05: coach/parent/admin event visibility; isolation on unrelated team |
| `emulator/create-event.emu.spec.ts` | `@events` | Admin creates an event on seeded team |
| `emulator/event-in-schedule.emu.spec.ts` | `@events` | Event appears in schedule after creation |
| `emulator/event-visibility.emu.spec.ts` | `@events` | EVENT-VIS-01–05: Firestore permission errors; event/empty-state on parent home; draft leak |
| `emulator/cancelled-event.emu.spec.ts` | `@events` | CANCEL-02: RSVP hidden; CANCEL-03: Cancel button absent; CANCEL-05: inline RSVP suppressed |
| `emulator/game-results.emu.spec.ts` | `@schedule` | RESULT-01–03, RESULT-05: section visible, score inputs, enter scores, save disabled |
| `emulator/messaging.emu.spec.ts` | `@messaging` | MSG-01–07, MSG-11: page load, sections, send disabled states, textarea, navigate away/back |
| `emulator/notification-state.emu.spec.ts` | `@messaging` | NOTIF-STATE-01–03, NOTIF-STATE-06: bell opens panel, backdrop closes, empty state |

---

## Role × bucket matrix

`Y` = covered by at least one @emu spec  
`skip` = test exists but skips gracefully due to data condition  
`manual` = manual checklist only (see below)  
`deferred` = not yet migrated  
`—` = not applicable

| Role | auth | teams | events | schedule | messaging | leagues | venues |
|------|------|-------|--------|----------|-----------|---------|--------|
| **admin** | Y | Y | Y | Y | Y | Y | — |
| **coach** | Y | Y | Y | Y | — | Y | — |
| **league_manager** | Y | Y (add-team) | — | — | — | Y | — |
| **parent** | Y | — | Y | — | — | — | — |
| **player** | Y (login only) | — | — | — | — | — | — |

---

## Tests deferred to Phase 3 / follow-up

### Admin specs (explicitly deferred — PM priority)

Do NOT migrate in Phase 2. Tracked for Phase 3 or a follow-up issue.

| Legacy spec | Reason for deferral |
|-------------|---------------------|
| `admin.spec.ts` | Admin-heavy CRUD; complex setup; admin fixtures exist but admin flows are PM-deprioritized for Phase 2 |
| `admin-users-full.spec.ts` | Requires ForcePasswordChange modal account state; complex staging-only admin patterns |

### Attendace spec (not migrated)

`attendance.spec.ts` — The 7 ATT-* tests require:
1. A seeded player in the team roster (not currently in seed-emulator.ts)
2. An attendance-capable past event already open in the panel

The seeded event uses `teamIds` but the seed does not create any player docs in
the roster subcollection. Migrating this spec requires extending seed-emulator.ts
to add at least one player to Emu Team A. This is tracked as a Phase 3 seed enhancement.

### Event lifecycle and coach CRUD (not migrated)

`event-lifecycle.spec.ts`, `coach.spec.ts` — These tests create throwaway teams
and events within each test body. This pattern works against staging (where the
data persists) but in the emulator each test run starts from the same seed state.
Creating new teams during an emulator run requires the `createTeamAndBecomeCoach`
Cloud Function (already running in the emulator), which is feasible. However,
migrating these tests requires substantially rewriting the setup helpers to use
the emulator's CF instead of AdminPage.createTeam() (a staging-only page object).

Recommendation: migrate in Phase 3 as a dedicated "emulator CRUD" enhancement.

### League manager full wizard (not migrated)

`league-manager.spec.ts` — This spec has 30+ tests covering the full schedule
wizard journey. The wizard calls `generateSchedule` (a Cloud Function) in the
generate/publish steps. Those calls are already skipped in the legacy spec.
The non-CF portions (mode picker, validation, config step) ARE migratable but
require creating leagues and teams via the UI within each test — the same CRUD
pattern as above. Recommend Phase 3.

### LM role spec (not migrated)

`lm-role.spec.ts` — The LM is seeded in the emulator (`emu-lm`) and linked to
`emu-league`. The LM-01 through LM-09 tests are structurally identical to the
coach-role tests already migrated. However, the legacy spec has data dependencies
on a staging fixture (`KNOWN_LEAGUE_NAME = 'test league'`) that doesn't map to
the emulator seed. Requires a quick rewrite scoped to EMU_IDS. Recommend Phase 3.

### Cross-role visibility CROSS-03 (player variant)

`cross-role-visibility.spec.ts` CROSS-03 — The player role is seeded but the
`asPlayer` fixture is not yet in the legacy `auth.fixture.ts`. The emulator
fixture (`playerPage`) is available. CROSS-03 is effectively covered by
CROSS-02 (same assertion, different role); formal player test deferred to Phase 3.

---

## Manual checklist only

These tests touch system boundaries that cannot be replicated in the emulator
(real SMTP delivery, OAuth, FCM push, Stripe), or require pre-configured staging
account state that is impractical to automate.

| Test | Legacy spec | Why manual |
|------|-------------|------------|
| ForcePasswordChangeModal gate | `auth-gates.spec.ts` | Requires a staging account with `mustChangePassword: true` in Firestore |
| ConsentUpdateModal gate | `auth-gates.spec.ts` | Requires a staging account with consent version below current LEGAL_VERSIONS |
| Resend verification email | `auth-logout.spec.ts` | Requires `emailVerified: false` account; emulator seeds all accounts as verified |
| Invite email delivery | `invite-flow.spec.ts` | Actual email delivery requires SMTP; no inbox to check in CI |
| Add player → invite appears (CF call) | `invite-flow.spec.ts` | `sendInvite` CF requires SMTP to confirm the invite was sent |
| Admin revoke invite | `invite-flow.spec.ts` | Requires a pre-existing pending invite in the test environment |
| RESULT-04 Submit Result (CF path) | `game-results.spec.ts` | `submitGameResult` CF; result confirmed via button state only |
| ATT-07 Pre-fill from RSVPs | `attendance.spec.ts` | Requires RSVPs seeded for the event |
| CANCEL-01 Cancelled hidden from parent | `cancelled-event.spec.ts` | Requires cross-session state (admin cancels, parent observes) — single-session emulator handles it via /parent navigation; partially covered by CANCEL-02/03/05 |
| CANCEL-04 Restore cancelled event | `cancelled-event.spec.ts` | EventForm may not expose a status field for restore via UI |
| MSG-04 Send disabled when subject empty (with recipients) | `messaging.spec.ts` | Requires platform users with email addresses in Firestore (not seeded) |
| MSG-08 Admin sees Platform Users section | `messaging.spec.ts` | Requires at least one user with an email address in Firestore |
| MSG-09 Selecting user updates recipient count | `messaging.spec.ts` | Same as MSG-08 |
| MSG-10 Clearing body re-disables send | `messaging.spec.ts` | Same as MSG-08 |
| NOTIF-STATE-04 Mark single item read | `notification-state.spec.ts` | Requires seeded unread notifications |
| NOTIF-STATE-05 Mark all read | `notification-state.spec.ts` | Requires seeded unread notifications |

---

## Phase 3 intentions

Phase 3 will:
1. Extend `seed-emulator.ts` to add player roster docs (enables `attendance.emu.spec.ts`)
2. Migrate `lm-role.spec.ts` → `lm-role.emu.spec.ts` scoped to EMU_IDS
3. Migrate CRUD-heavy specs (`event-lifecycle`, `coach`) once AdminPage is replaced with CF-based helpers
4. Retire legacy `e2e/*.spec.ts` files (they will be deleted in Phase 3)
5. Decommission staging global-setup seeding (only emulator seed survives)
