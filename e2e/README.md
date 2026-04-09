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
| `E2E_COACH_EMAIL` | Yes | Email for a coach test account (assigned to E2E Team A by seeding) |
| `E2E_COACH_PASSWORD` | Yes | Password for the coach test account |
| `E2E_LM_EMAIL` | Yes | Email for a league manager test account |
| `E2E_LM_PASSWORD` | Yes | Password for the league manager test account |
| `E2E_INVITE_PARENT_EMAIL` | No | An email address to use as an invite target (invite creation tests only) |
| `E2E_STAGING_URL` | No | Staging base URL. Defaults to `https://staging.firstwhistlesports.com` |
| `E2E_FUNCTIONS_BASE` | No | Base URL for Cloud Functions. Defaults to the production `us-central1` URL baked into the Cloud Function binary. Required when testing against staging or a non-default region. |
| `E2E_RSVP_HMAC_SECRET` | No** | The `RSVP_HMAC_SECRET` value provisioned in Firebase Secret Manager. Required for `email-rsvp.spec.ts` happy-path tests. Without it those tests self-skip (#318). |
| `GOOGLE_APPLICATION_CREDENTIALS` | No* | Path to a Firebase service account JSON file. Required for Firestore data seeding. See below. |

\* Required for data-dependent tests to run fully. Without it, those tests self-skip with a clear message.

\*\* Obtain from Firebase Console → Secret Manager → `RSVP_HMAC_SECRET` (staging project). Store as a GitHub Actions secret named `E2E_RSVP_HMAC_SECRET`. Never commit the value.

### Setting up a local .env file

Create a file at the project root called `.env.e2e` (this is gitignored):

```bash
E2E_ADMIN_EMAIL=admin@yourapp.com
E2E_ADMIN_PASSWORD=your-admin-password
E2E_PARENT_EMAIL=parent@yourapp.com
E2E_PARENT_PASSWORD=your-parent-password
E2E_PLAYER_EMAIL=player@yourapp.com
E2E_PLAYER_PASSWORD=your-player-password
E2E_COACH_EMAIL=coach@yourapp.com
E2E_COACH_PASSWORD=your-coach-password
E2E_LM_EMAIL=lm@yourapp.com
E2E_LM_PASSWORD=your-lm-password
E2E_INVITE_PARENT_EMAIL=invite-target@example.com
GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-sa.json
E2E_FUNCTIONS_BASE=https://us-central1-first-whistle-staging.cloudfunctions.net
E2E_RSVP_HMAC_SECRET=your-rsvp-hmac-secret-value-here
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

## Synthetic Test Data Seeding

### What `isE2eData` documents are

All Firestore documents created by the E2E suite are tagged with `isE2eData: true`.
This field is used exclusively to identify and clean up seeded data — it has no
effect on the application.  Seeded documents live in the normal production collections
(`teams`, `leagues`, `events`, `venues`, `leagues/{id}/seasons`) alongside real data,
but their names all start with "E2E " making them easy to identify in the Firebase Console.

### How global-setup seeds them

`e2e/global-setup.ts` runs before all tests via Playwright's `globalSetup` hook.
After logging in each role account it calls `seedTestData()`, which:

1. Checks each collection for an existing `isE2eData: true` document.
2. Creates any missing pieces (league → venue → teams → season → event).
3. Writes the resulting document IDs to `e2e/.auth/test-data.json`.

Seeding is **idempotent** — running global-setup twice produces the same set of documents.
If a partial run left behind some but not all documents, only the missing ones are created.

The seeded dataset is:

```
E2E Test League  (leagues/{leagueId})
  └── E2E Season {year}  (leagues/{leagueId}/seasons/{seasonId})
       ├── E2E Team A  (teams/{teamAId})   — coach account's UID is in coachIds
       └── E2E Team B  (teams/{teamBId})
            └── E2E Test Game  (events/{eventId})
                 — date = yesterday, status = 'published', no result yet
                 — linked to the seeded leagueId + seasonId

E2E Test Venue  (venues/{venueId})  — linked to Team A as homeVenueId
```

### How global-teardown cleans them up

`e2e/global-teardown.ts` runs after all tests via Playwright's `globalTeardown` hook.
It queries each collection for `isE2eData: true` and batch-deletes all matching documents.
Season subcollections are deleted before their parent league documents.

Teardown failure is **non-fatal** — a warning is logged and the test run result is not
affected.  The next global-setup run will reuse or patch whatever documents remain.

### How tests consume seeded data

Tests load seeded IDs via `e2e/helpers/test-data.ts`:

```typescript
import { loadTestData } from './helpers/test-data';

const testData = loadTestData(); // null if seeding was skipped
if (!testData) {
  test.skip(true, 'E2E seed data not available — set GOOGLE_APPLICATION_CREDENTIALS');
  return;
}
// use testData.teamAId, testData.eventId, testData.leagueId, etc.
```

### Running seeding locally

Set `GOOGLE_APPLICATION_CREDENTIALS` to the path of a Firebase service account JSON file
with Firestore read/write access on your target project (staging):

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-service-account.json
npm run test:e2e
```

The service account needs: `Cloud Datastore User` role (Firestore read/write) and
`Firebase Authentication Admin` role (to look up the coach UID by email).

### New CI secret required: `E2E_FIREBASE_SERVICE_ACCOUNT_JSON`

To enable seeding in CI, add a GitHub Actions secret named `E2E_FIREBASE_SERVICE_ACCOUNT_JSON`
containing the **base64-encoded** service account JSON.

Generate it locally:
```bash
base64 -i /path/to/staging-service-account.json | pbcopy
```

Then add the value to: **GitHub → Settings → Secrets and variables → Actions → New repository secret**.

The CI workflow decodes it to `/tmp/sa.json` and sets `GOOGLE_APPLICATION_CREDENTIALS=/tmp/sa.json`
before running tests.  See `.github/workflows/e2e-staging.yml`.

---

## Test Accounts

You need Firebase test accounts for each role in the staging project:

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

### Coach account
- Role: `coach`
- Firestore profile must have `role: 'coach'`
- When `GOOGLE_APPLICATION_CREDENTIALS` is set, global-setup resolves this account's UID
  from `E2E_COACH_EMAIL` and writes it into E2E Team A's `coachIds` array

### League Manager account
- Role: `league_manager`
- Must be linked to a league (the staging test league named "test league")

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
  email-rsvp.spec.ts        One-tap unauthenticated RSVP via signed email link; endpoint error paths
  parent.spec.ts            Parent home page, authenticated RSVP UI, state persistence
  player.spec.ts            Player home page, RSVP flow, access control, profile
  invite-flow.spec.ts       Full invite lifecycle: add player → invite → revoke
  coach-role.spec.ts        Coach routing, team access, blocked routes
  lm-role.spec.ts           League manager routing, league access, blocked routes
  game-results.spec.ts      Result recording section, score inputs, save/submit
  attendance.spec.ts        Attendance tracking, counter, status persistence
  cross-role-visibility.spec.ts  Cross-role event visibility, edit control isolation
  standings.spec.ts         Standings table, round-trip result submit test
  environment.spec.ts       Dev/staging environment banner, page smoke tests
  environment.prod.spec.ts  Production-only: no banner, no console errors
  environment.staging.spec.ts  Staging-only: banner is present

  pages/
    AuthPage.ts             Page Object for /login and /signup
    AdminPage.ts            Page Object for /teams and /teams/:id
    ParentHomePage.ts       Page Object for /parent
    CoachPage.ts            Page Object for coach home
    LeagueManagerPage.ts    Page Object for LM home

  fixtures/
    auth.fixture.ts         Playwright fixture extending test with page objects + login helpers

  helpers/
    test-data.ts            Loads e2e/.auth/test-data.json (seeded IDs)

  global-setup.ts           Auth login + Firestore data seeding (runs before all tests)
  global-teardown.ts        Firestore data cleanup (runs after all tests)

  .auth/                    Gitignored — auth state files + test-data.json written here
    admin.json
    coach.json
    lm.json
    parent.json
    player.json
    test-data.json          Seeded document IDs written by global-setup
```

---

## Running Specific Suites

```bash
# Auth tests only
npx playwright test e2e/auth.spec.ts

# Coach role tests only
npx playwright test e2e/coach-role.spec.ts

# Standings round-trip test only
npx playwright test e2e/standings.spec.ts --grep "STAND-RT-01"

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
| One-tap email RSVP confirms attendance (yes) | `email-rsvp.spec.ts` | navigating a valid RSVP yes-link shows the Attending confirmation page |
| One-tap email RSVP confirms not attending (no) | `email-rsvp.spec.ts` | navigating a valid RSVP no-link shows the Not Attending confirmation page |
| Tampered RSVP token is rejected | `email-rsvp.spec.ts` | rejects a tampered RSVP token with 403 |
| Malformed RSVP link returns 400 | `email-rsvp.spec.ts` | returns 400 for a malformed RSVP link missing required params |
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
leftover "E2E *" named teams/players can be deleted manually via the admin UI, or by
running the teardown manually (see `docs/RUNBOOK.md` — "Manually wipe E2E seed data").

---

## Troubleshooting

**Tests fail immediately with "Missing required environment variable"**
Set the env vars documented above. See "Setting up a local .env file".

**Data-dependent tests are all skipping with "E2E seed data not available"**
Set `GOOGLE_APPLICATION_CREDENTIALS` to a staging service account JSON path.
See "Running seeding locally" above.

**Session timeout tests fail with wrong URL**
These tests use `page.clock.install()` (Playwright fake timers). Confirm you are on
Playwright >= 1.45. Check `npx playwright --version`.

**RSVP tests are skipped**
The parent account has no upcoming events. Add a future event via the admin UI and try again.

**email-rsvp.spec.ts happy-path tests all skip with "E2E_RSVP_HMAC_SECRET not set"**
Set `E2E_RSVP_HMAC_SECRET` to the value of the `RSVP_HMAC_SECRET` Firebase Secret (staging project).
Retrieve it from: Firebase Console → Secret Manager → RSVP_HMAC_SECRET → View secret value.
For CI, add it as a GitHub Actions secret named `E2E_RSVP_HMAC_SECRET`.
The error-path tests (400 / 403 responses) still run without this variable.

**STAND-RT-01 skips with "submitGameResult Cloud Function returned an error"**
The seeded event may lack `leagueId` or `seasonId` fields, or the function is not deployed.
Re-seed by deleting the `isE2eData` event in Firestore console and re-running global-setup.

**Firebase callable function timeouts**
The invite creation test calls `sendInvite` Cloud Function. On the local emulator this is
fast; against a cold production function it may need the 15s action timeout. If you see
consistent timeouts, increase `actionTimeout` in `playwright.config.ts`.
