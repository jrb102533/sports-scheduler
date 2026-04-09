# First Whistle — Playwright UAT Suite

End-to-end user acceptance tests for the First Whistle sports scheduler.
These tests directly map to the go-live smoke test checklist in `docs/GO_LIVE_CHECKLIST.md`.

---

## Quick Start

```bash
# Install browsers (first time only)
npx playwright install chromium

# Run all tests against local dev server
npm run test:e2e

# Run in headed mode (watch the browser)
npm run test:e2e:headed

# Run against production
npm run test:e2e:prod
```

---

## Environment Variables

All credentials are read from environment variables. **Never hardcode credentials in test files.**

| Variable | Required | Description |
|---|---|---|
| `E2E_BASE_URL` | No | Base URL to test against. Defaults to `http://localhost:5173` |
| `E2E_ADMIN_EMAIL` | Yes | Email for the admin test account |
| `E2E_ADMIN_PASSWORD` | Yes | Password for the admin test account |
| `E2E_PARENT_EMAIL` | Yes | Email for a parent test account pre-linked to a team |
| `E2E_PARENT_PASSWORD` | Yes | Password for the parent test account |
| `E2E_PLAYER_EMAIL` | Yes | Email for a player test account pre-linked to a team |
| `E2E_PLAYER_PASSWORD` | Yes | Password for the player test account |
| `E2E_INVITE_PARENT_EMAIL` | No | An email address to use as an invite target (invite creation tests only) |
| `E2E_STAGING_URL` | No | Staging base URL. Defaults to `https://staging.firstwhistlesports.com` |

### Setting up a local .env file

Create a file at the project root called `.env.e2e` (this is gitignored):

```bash
E2E_ADMIN_EMAIL=admin@yourapp.com
E2E_ADMIN_PASSWORD=your-admin-password
E2E_PARENT_EMAIL=parent@yourapp.com
E2E_PARENT_PASSWORD=your-parent-password
E2E_PLAYER_EMAIL=player@yourapp.com
E2E_PLAYER_PASSWORD=your-player-password
E2E_INVITE_PARENT_EMAIL=invite-target@example.com
```

Then load it before running:

```bash
export $(cat .env.e2e | xargs) && npm run test:e2e
```

Or use a tool like `dotenv-cli`:

```bash
npx dotenv -e .env.e2e -- npm run test:e2e
```

---

## Test Accounts

You need two Firebase test accounts:

### Admin account
- Role: `admin`
- Has at least one team (or tests will create throwaway teams)
- The account used for: team management, invite management, schedule management

### Parent account
- Role: `parent`
- Must be linked to at least one team (has a `teamId` in their Firestore profile)
- Team must have at least one upcoming event for RSVP tests to run (otherwise those tests self-skip)

### Player account
- Role: `player`
- Must be linked to at least one team (has a `teamId` in their Firestore profile, or a `memberships` entry with a `teamId`)
- Both player and parent roles share the `/parent` route — players see the same home page but represent themselves (not a child)
- Team must have at least one upcoming event for RSVP tests to run (otherwise those tests self-skip)

### Local (emulator) setup
When running against the local Firebase Emulator, create these accounts via:
```bash
firebase emulators:start --import=./emulator-data
```
Then create the accounts in the Emulator Auth UI at http://localhost:4000/auth.
Seed the Firestore data (teams, players, events) so parent account tests have something to work with.

---

## Test Structure

```
e2e/
  auth.spec.ts              Login, logout, session timeout, signup validation
  admin.spec.ts             Team CRUD, player management, access control
  parent.spec.ts            Parent home page, RSVP flow, state persistence
  player.spec.ts            Player home page, RSVP flow, access control, profile
  invite-flow.spec.ts       Full invite lifecycle: add player → invite → revoke
  environment.spec.ts       Dev/staging environment banner, page smoke tests
  environment.prod.spec.ts  Production-only: no banner, no console errors
  environment.staging.spec.ts  Staging-only: banner is present

  pages/
    AuthPage.ts             Page Object for /login and /signup
    AdminPage.ts            Page Object for /teams and /teams/:id
    ParentHomePage.ts       Page Object for /parent

  fixtures/
    auth.fixture.ts         Playwright fixture extending test with page objects + login helpers
```

---

## Running Specific Suites

```bash
# Auth tests only
npx playwright test e2e/auth.spec.ts

# Admin tests only
npx playwright test e2e/admin.spec.ts

# Parent RSVP tests only
npx playwright test e2e/parent.spec.ts

# Production environment check (against firstwhistlesports.com)
npx playwright test --project=production

# Staging environment check
npx playwright test --project=staging
```

---

## Go-Live Checklist Mapping

Passing `npm run test:e2e:prod` against `https://firstwhistlesports.com` = passing the
relevant automated items in `docs/GO_LIVE_CHECKLIST.md`.

| Checklist item | Test file | Test name |
|---|---|---|
| Admin creates a team | `admin.spec.ts` | admin can create a new team |
| Admin adds a player with parent email | `invite-flow.spec.ts` | adding a player with a parent email creates an invite |
| Invite appears in Invites tab | `invite-flow.spec.ts` | adding a player... |
| Invite disappears after parent accepts | `invite-flow.spec.ts` | (manual step — email click required) |
| Admin can revoke a pending invite | `invite-flow.spec.ts` | admin can revoke a pending invite |
| Parent sees team and schedule | `parent.spec.ts` | parent home page shows a team header |
| RSVP button appears and can be tapped | `parent.spec.ts` | parent can RSVP Going on an event |
| RSVP state persists after refresh | `parent.spec.ts` | RSVP state persists after page refresh |
| Login with valid credentials | `auth.spec.ts` | logs in with valid credentials |
| Login with wrong password → correct error | `auth.spec.ts` | shows "Incorrect email or password" |
| Session idle 30 min → warning modal | `auth.spec.ts` | shows Session Expiring modal after 30 minutes |
| Stay Signed In dismisses modal | `auth.spec.ts` | Stay Signed In dismisses the session timeout modal |
| Countdown reaching zero logs user out | `auth.spec.ts` | auto-logs out when countdown expires |
| Production banner NOT visible on prod | `environment.prod.spec.ts` | production environment banner is NOT visible |
| Staging banner IS visible on staging | `environment.staging.spec.ts` | staging environment banner IS visible |

---

## Idempotency

Tests that create data (teams, players) generate unique names using `Date.now()` to avoid
collisions. Tests clean up after themselves where possible. If a test run is interrupted,
leftover "E2E *" named teams/players can be deleted manually via the admin UI.

---

## Troubleshooting

**Tests fail immediately with "Missing required environment variable"**
Set the env vars documented above. See "Setting up a local .env file".

**Session timeout tests fail with wrong URL**
These tests use `page.clock.install()` (Playwright fake timers). Confirm you are on
Playwright >= 1.45. Check `npx playwright --version`.

**RSVP tests are skipped**
The parent account has no upcoming events. Add a future event via the admin UI and try again.

**Firebase callable function timeouts**
The invite creation test calls `sendInvite` Cloud Function. On the local emulator this is
fast; against a cold production function it may need the 15s action timeout. If you see
consistent timeouts, increase `actionTimeout` in `playwright.config.ts`.
