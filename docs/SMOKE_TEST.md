# First Whistle — Pre-Deploy Smoke Test

Run this before every merge to main / deploy to staging. Target: ~20 minutes.

---

## P0 — Must Pass (Blocking)

These break core user value. Do not deploy if any P0 fails.

### Auth
- [ ] **Sign up** — new email, fill all fields, submit → lands on "check your email" screen, no errors
- [ ] **Sign in** — valid credentials → dashboard loads, display name correct
- [ ] **Sign in — wrong password** → error message shown, no crash
- [ ] **Sign out** → redirected to login, no stale data visible

### Profile
- [ ] **Edit name** — change first + last name, save → updated in header immediately
- [ ] **Empty first name** — clear field, blur → validation error shown, save blocked
- [ ] **Empty last name** — same

### Venues
- [ ] **Create venue** — fill name + address, save → venue appears in list
- [ ] **Create venue — missing name** → validation error, not saved
- [ ] **Title bar** — on `/venues` page → shows "Venues" (not "First Whistle")

### Schedule Wizard
- [ ] **Open wizard** → modal opens, mode selector shown
- [ ] **Generate schedule** (season mode, ≥ 2 teams, 1 venue with availability) → schedule generated, no internal error
- [ ] **Publish schedule** → events created, success state shown

### General
- [ ] **No console errors** on any P0 screen (open DevTools before starting)

---

## P1 — Should Pass (Non-Blocking but Important)

Run these after P0. Failures should be logged as bugs before next release.

### Teams & Leagues
- [ ] **Create team** → appears in team list
- [ ] **Create league** → appears in league list
- [ ] **Add team to league** → team linked, visible in league detail

### Roster
- [ ] **Add player to team** → appears in roster
- [ ] **Edit player** → changes saved

### Events
- [ ] **Create one-off event** (from team schedule tab) → appears on calendar
- [ ] **Submit game result** → score saved, event marked completed

### Schedule Wizard — Edge Cases
- [ ] **Wizard with 0 venues** → appropriate error or disabled state, no crash
- [ ] **Wizard with 1 team** → generate disabled or clear error

### Notifications
- [ ] **Notification badge** → appears when unread notifications exist
- [ ] **Mark all read** → badge clears

### Navigation
- [ ] **All main nav links** → no 404s, no blank screens

---

## P2 — Regression Checks (Per-Feature)

Run these only when the related feature was changed in the PR.

| Feature changed | Test to run |
|---|---|
| Auth / sign-up flow | Full sign-up with email verification |
| Venue form | Create, edit, delete venue |
| Schedule wizard | Full wizard run: mode → publish |
| Profile page | Name edit + role edit |
| Admin user management | Create user by admin, edit, delete |
| Player invites | Send invite, sign up with matching email → auto-link |
| Coach availability | Request availability, submit via email link |
| RSVP | Send invite, RSVP via email link, check event detail |
| Recurring events | Create recurring event, edit one, edit series |
| Notifications | Trigger notification, view, mark read |
| Standings | Submit result, verify standings update |
| Firebase rules | Attempt direct Firestore write to blocked field → rejected |

---

## Known Pre-Existing Issues (Don't Block on These)

- `authHelpers.test.ts` fails in Vitest — `__APP_VERSION__` not defined (tracked: #120)
- `saveFixtures` divisionId write not covered by emulator test (tracked: #119)

---

## Environment

- **Staging**: https://first-whistle-e76f4.web.app
- **DevTools**: open before starting — watch Console and Network tabs
- **Test account**: use a dedicated smoke-test account, not your personal account
