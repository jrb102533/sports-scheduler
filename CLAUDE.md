# First Whistle — Development Context

## Product

First Whistle is a youth sports scheduling and team management platform. Target users: coaches, league managers, parents, and players. Core value prop: schedule games, track rosters, manage leagues — all in one place.

**Current stage**: Soft launch with 1 team. Priority is parent-facing features and email communications.

**Full PRD**: `docs/PRD.md` (screens, data model, API reference, mobile architecture)

## Architecture

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS + Zustand (state)
- **Backend**: Firebase (Auth, Firestore, Cloud Functions, Storage)
- **Hosting**: Firebase Hosting (`first-whistle-e76f4.web.app`)
- **Email**: SMTP via Cloud Functions with branded HTML templates (`functions/src/emailTemplate.ts`)
- **RSVP**: One-tap email RSVP via HTTP endpoint with HMAC-signed links (no login required)

## Critical Patterns

### Zustand Store Safety (PREVENTS React Error #185)

**NEVER** do this — it causes infinite re-render loops:
```tsx
// BAD: no-selector subscribes to ENTIRE store, re-renders on any change
const { fetchSeasons } = useSeasonStore();
useEffect(() => { fetchSeasons(id); }, [id, fetchSeasons]); // infinite loop!
```

**ALWAYS** do this instead:
```tsx
// GOOD: select only the data you need
const seasons = useSeasonStore(s => s.seasons);

// GOOD: use getState() for actions inside effects
useEffect(() => {
  return useSeasonStore.getState().fetchSeasons(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [id]);
```

Rules:
1. **Data selectors**: `useStore(s => s.field)` — returns stable reference for primitives
2. **Actions in effects**: `useStore.getState().action()` — never put actions in deps array
3. **Auth store**: Never select `s => s.user` (Firebase User object changes reference). Use `s => s.user?.uid` or `s => Boolean(s.user)`
4. **eslint-disable**: Add `// eslint-disable-next-line react-hooks/exhaustive-deps` when intentionally omitting getState() actions from deps

### Firestore Write Error Handling (PREVENTS silent data loss)

Every user-initiated Firestore write **must** be awaited and wrapped in try/catch. Fire-and-forget writes silently discard errors — the UI closes/proceeds normally while the data was never saved.

**NEVER** do this:
```tsx
// BAD: error is silently swallowed; form closes; user thinks save succeeded
updateEvent({ ...event });
onClose();
```

**ALWAYS** do this for user-initiated writes:
```tsx
// GOOD: error is caught, user sees feedback, form stays open on failure
const [isSaving, setIsSaving] = useState(false);
const [saveError, setSaveError] = useState<string | null>(null);

async function doSave() {
  setSaveError(null);
  setIsSaving(true);
  try {
    await updateEvent({ ...event });
    onClose();
  } catch (err) {
    console.error('[ComponentName] save failed:', err);
    setSaveError('Failed to save — please try again.');
  } finally {
    setIsSaving(false);
  }
}
```

UI requirements when `isSaving`/`saveError` state is added:
- Save button shows `"Saving…"` and is `disabled` while in flight
- Cancel button is also `disabled` while saving (prevents closing mid-write)
- Error banner appears above the action buttons on failure

**Background/subscription writes** (e.g. `onSnapshot` error handlers) must `console.error` the error — never swallow silently with `() => {}`.

### Email Templates

All emails use `buildEmail()` from `functions/src/emailTemplate.ts` with the branded HTML template at `functions/email-templates/base-template.html`. RSVP emails use `rsvpButtonsHtml()` for one-tap buttons.

### Firestore Security Rules

- `firestore.rules` — role-based access control
- Admin can do anything; coaches manage their teams; parents/players read-only on team data
- Sensitive player data (PII) in restricted subcollections

### Firestore Read Discipline (PREVENTS quota overages)

Every Firestore read has a cost. The free quota is 50K reads/day — an unscoped global subscription exhausts it in hours. Apply these rules in all solution design and implementation:

**Never subscribe globally without a user-scoped filter.**
```typescript
// BAD — reads every event in the database for every user
onSnapshot(collection(db, 'events'), ...)

// GOOD — scoped to the teams the user belongs to
onSnapshot(query(collection(db, 'events'), where('teamId', 'in', userTeamIds)), ...)
```

**Lazy beats eager.** Prefer `getDocs` on navigation over a persistent `onSnapshot` for data not rendered on every screen.

**No N+1 queries.** Never `getDoc` inside a loop or `.map()`. Batch with `where('id', 'in', [...ids])` or denormalize.

**Cloud Functions: bound your reads.** Nested team → players → users reads are O(teams × players). Cache email lists, denormalize recipient arrays onto the doc, or use a notifications collection.

**Admins are not exceptions.** An admin `onSnapshot` on an unfiltered collection still costs one read per doc per change. Paginate or scope admin queries.

**Checklist before any new Firestore read:**
- Scoped to the current user's teams/leagues/role?
- Lazy (triggered by navigation) rather than eager (on app load)?
- Avoids re-reading data already in a Zustand store?
- For CFs: read count bounded independently of dataset growth?

### Cost Discipline Architecture (ADR-012)

Three hard rules, enforced at the code/CI layer not by tribal knowledge:

**1. Every `onSchedule(...)` MUST guard with `ENV.shouldRunScheduledJobs()`.**
```typescript
// functions/src/index.ts
import { ENV } from './env';

export const myJob = onSchedule(..., async () => {
  if (!ENV.shouldRunScheduledJobs()) {
    console.log('[myJob] skipped: scheduled jobs disabled');
    return;
  }
  // real work
});
```
Defaults: production runs normally; staging skips (no real users to notify); emulator skips. Override on a specific staging deploy with `STAGING_ENABLE_SCHEDULES=true`. Reviewers/agents must reject any new scheduled CF that omits this guard — Firebase silently re-creates Cloud Scheduler jobs as ENABLED on every deploy, so the only durable defense is in the function body.

**2. `deploy.yml` is path-scoped — `firebase deploy --only` deploys ONLY what changed.** Docs-only / legal-only / test-only PRs deploy nothing. Path → target mapping lives in `.github/workflows/deploy.yml` `paths-filter` step. When adding a new top-level directory or deployable artifact, update the path filters in the same PR.

**3. NO auto-firing E2E against live staging Firestore.** `e2e-smoke.yml` has no `on:` trigger; the smoke-reminder job in `release.yml` is removed. E2E redesign tracked as FW-80 (move to emulator). Do not propose re-enabling.

## TypeScript Import Discipline

### Type-only imports are mandatory for types (`verbatimModuleSyntax`)

The production CI build uses `verbatimModuleSyntax: true` in `tsconfig`. Local `tsc --noEmit` may pass even without `type` qualifiers, but the production Vite build will fail with:

```
'X' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
```

**Always** import types with the `type` keyword:

```typescript
// BAD — fails production build
import { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';

// GOOD — use inline type qualifier
import { type QueryDocumentSnapshot, type DocumentData } from 'firebase/firestore';

// GOOD — or a separate type import
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
```

This applies to all type-only symbols: Firestore types, custom interfaces/types from `@/types`, third-party SDK types, etc. When adding new imports, check whether the symbol is a runtime value (class, function, constant) or a pure type. Pure types always need `type`.

## 12-factor config

Follow 12-factor app methodology for all development:

- **Config**: Store all config in environment variables, never hardcode
- **Dependencies**: Explicitly declare all dependencies (package.json, requirements.txt, etc.)
- **Backing services**: Treat databases, queues, and APIs as attached resources via env vars
- **Build/run separation**: Keep build, release, and run stages distinct
- **Processes**: App is stateless — no sticky sessions, no local file storage
- **Port binding**: Export services via port binding, not web server injection
- **Logs**: Treat logs as event streams (stdout/stderr only, never write to files)
- **Dev/prod parity**: Keep environments as similar as possible

## Key Files

| File | Purpose |
|------|---------|
| `docs/PRD.md` | Full product requirements + mobile architecture |
| `docs/CHANGE_CONTROL.md` | Branch strategy, PR gates, deploy pipeline, rollback, agent roles |
| `docs/RUNBOOK.md` | Operational scripts and maintenance procedures |
| `src/store/useAuthStore.ts` | Auth state, profile, role helpers, team access |
| `src/layouts/MainLayout.tsx` | Root layout, all Firestore subscriptions |
| `src/router/index.tsx` | All routes/screens |
| `src/types/index.ts` | Full data model |
| `functions/src/index.ts` | All Cloud Functions (email, RSVP, scheduling) |
| `functions/src/emailTemplate.ts` | Branded email template builder |
| `functions/src/scheduleAlgorithm.ts` | Schedule generation algorithm |
| `firestore.rules` | Security rules |

## Firebase API Key — No HTTP Referrer Restrictions

The Web API key in Google Cloud Console (APIs & Services → Credentials) has **Application restrictions set to None** for all Firebase projects. Do not add HTTP referrer restrictions.

**Why:** The API key is embedded in the JS bundle and visible to anyone in DevTools — restricting referrers adds no real security. Actual security is enforced by Firestore rules and Firebase Auth. Referrer restrictions only cause `auth/requests-from-referer-...-are-blocked` errors when new domains are added (staging deploys, custom domains, previews) and need to be debugged every time.

Authorized domains are managed in one place only: **Firebase Console → Authentication → Settings → Authorized Domains**.

## Deployment Policy

### Hard rule: never deploy to production from the CLI

**Always deploy to production via the `release.yml` GitHub Actions workflow** — never via `firebase deploy` from the terminal. The GitHub `environment: production` gate requires human approval before deploying. Running `firebase deploy --project production` locally bypasses that gate entirely.

To deploy to production:
1. Merge the PR to `main`
2. **Deploy to staging first** — `npm run build:staging && firebase deploy --project staging`
3. Wait for the "E2E Smoke — Staging" workflow to complete and pass (triggers automatically after staging deploy)
4. Go to GitHub → Actions → "Release" workflow → Run workflow
5. Wait for the approval notification and approve it

The release pipeline verifies a passing smoke run exists for the exact SHA being deployed. If you skip staging or commit directly to main without a staging deploy, the release will fail at "Verify Staging Smoke Passed" with `ERROR: No E2E Smoke — Staging run found for SHA <sha>`. Always deploy staging before triggering release.

Staging deploys (`firebase deploy --project staging`) from the CLI are fine and required before every production release.

### Hard rule: merge before deploy

**No production deploys without a merged PR.** This applies to all targets: `hosting`, `functions`, `firestore:rules`, `firestore:indexes`.

Enforcement layers:
1. **GitHub Actions `environment: production` gate** — the deploy workflow pauses for human approval (primary enforcement)
2. **Branch protection on `main`** — PRs required before merging
3. **This policy** — all agents must follow it

### Hotfix exception (active outage or data breach only)

If production is down or actively leaking data:
1. Push the fix branch to remote
2. Open a PR and get it **approved** (not just opened) before deploying
3. Deploy from the branch
4. Merge the PR to `main` within 24 hours post-incident
5. Note the bypass reason in the PR body

"We want to test in prod" or "review will take too long" are not valid exceptions.

### Firestore rules changes

`firestore.rules` changes have the highest blast radius — a permissive rule takes effect instantly and fails silently (no app-layer error, no trace unless Firestore audit logging is enabled). **All PRs touching `firestore.rules` require the security-engineer agent review before merge.**

## TDD & Quality Standards

### Core discipline

- **Write the failing test first.** The test IS the spec — derive it from acceptance criteria, not from implementation
- **RED → GREEN → REFACTOR.** No code ships without a prior failing test (unit or E2E)
- **Regression rule:** When a bug is confirmed, a failing test reproducing it must be committed *before* the fix. The fix is not mergeable until that test passes
- **Vacuous assertions are bugs.** `|| true`, `expect(true).toBe(true)`, empty test bodies — treat these as build failures, not placeholders

### Test pyramid for this stack

| Layer | Tool | What belongs here |
|-------|------|-------------------|
| Unit | Vitest + RTL | Pure functions, store logic, Cloud Function helpers, Firestore rule unit tests |
| Integration | Vitest + emulators | Store ↔ Firestore, Cloud Function ↔ Auth flows |
| E2E | Playwright (staging) | Full user journeys, role access control, cross-role visibility, real Firestore rules |

**Never mock Firestore or Auth in E2E tests.** Always use the real staging environment so security rules are exercised. We got burned when mocked tests passed but prod rules blocked the real flow.

### Role-based coverage

- Every feature must be tested from the perspective of **each affected role** (admin, coach, parent, player, league_manager)
- Access control tests are mandatory: verify both that permitted roles **CAN** act and excluded roles **CANNOT**
- Use dedicated staging test accounts per role — never reuse accounts across roles in the same test

### Test file conventions

- Unit tests: co-located as `ComponentName.test.tsx` or `util.test.ts` next to the file under test
- E2E specs: `e2e/*.spec.ts` — one file per feature area, not per page
- Page objects: `e2e/pages/PageName.ts` — one per major route, reused across specs
- Fixtures: `e2e/fixtures/auth.fixture.ts` — role fixtures only; add new roles here when new accounts are created

### Don't duplicate coverage across layers

- If a validation rule is unit-tested, the E2E test only needs to confirm the form submits or rejects — not re-test every invalid input
- E2E covers the happy path and role-based access boundaries. Edge cases belong in unit/integration tests
- Write the Playwright spec **before** the feature branch has any implementation — the spec is the acceptance criteria in code. Expect it to stay red across multiple commits until the full flow is wired

### Playwright rules

- **`test.skip(true, reason)`** for data-dependent tests with missing staging data — never fail silently
- **Never `test.skip()` without a linked issue number** in the reason string
- All skip blocks must be resolved before a feature is considered fully covered
- Test accounts live in staging Firebase Auth + Firestore — document new accounts in `e2e/README.md`
- `page.clock.install()` for session timeout tests must be called **after** login so Firebase Auth uses real time
- **No `sleep` or fixed-time waits.** Use `waitForSelector`, `waitForURL`, or Playwright's built-in auto-waiting. Fixed waits are flaky by design

### Firebase-specific rules

- **Firestore rules**: test with `@firebase/rules-unit-testing` emulator. Write rule tests for every role boundary — verify both allowed AND denied access. A missing rule test is a security gap
- Cloud Functions: extract business logic from the Firebase trigger wrapper and unit-test it. E2E tests call the real deployed function
- Never test `publishSchedule`, `deleteTeam`, or other irreversible CF mutations in E2E — they permanently alter staging data

### Definition of done

- Tests pass for **every affected role**, not just the happy path
- CI E2E is green on staging before a PR is marked ready for review
- Any test changed from `expect(...)` to `skip` requires a linked ticket in the reason string
- When a feature changes, update its E2E tests in the **same PR** — never defer to a follow-up

### When NOT to write tests

- One-off admin scripts (`scripts/*.mjs`)
- Config files (`.env`, `firebase.json`, `vite.config.ts`)
- Generated code or migrations that run once

## Support Edge Cases

Operational edge cases that require admin action (no in-app UI) are documented in `docs/SUPPORT_NOTES.md`. When a new edge case is identified during design or implementation, add it there immediately — don't defer.

## Work Tracking

**Use Jira (project FW) to track all in-progress work.** When starting implementation on any feature, bug, or task:
1. Find or create the corresponding Jira issue in the FW project (https://jrboyd33dev.atlassian.net)
2. Transition it to "In Progress" via `transitionJiraIssue`
3. Transition to "Done" when the PR is merged

Do not use GitHub issues as the primary tracking system — Jira is the source of truth for work status. GitHub issues may still be used for security findings and automated tooling that writes to GitHub.

## Collaboration Rules

### Security — never request credentials in chat

**Never ask the PM or any user for passwords, API keys, secrets, or credentials in this conversation.** All secrets live in GitHub Actions (Settings → Secrets) or Firebase Secret Manager. If credentials need to be verified or rotated, direct the user to those systems — do not ask them to paste values here.

### GitHub Actions — never use `gh run watch` for long-running jobs

**Never run `gh run watch` for CI jobs that take more than a few minutes.** It polls the GitHub API every 3 seconds and will exhaust the rate limit, blocking all API access for ~1 hour.

Instead: check status on demand with `gh run view <run-id>` when asked. Do not leave a background watcher running for E2E suites or any job expected to run >10 minutes.

### Always give a recommendation

When the PM asks for options or "what do you recommend", **always lead with a clear expert recommendation** — not a neutral list. Present the options briefly for context, then state which one to pick and why. The PM delegates technical decisions; hedging wastes their time.

Format:
1. State the recommendation upfront
2. One sentence of rationale
3. Brief option summary if helpful

Never end with "what's your preference?" without first giving your own answer.

---

## Backlog

- #202 — Schedule wizard draft resume
- #203 — Incomplete game generation + no draft view
- #204 — Simplify empty Seasons tab
- #205 — TopBar user name/login
- #206 — Bulk delete draft schedule games (delete selected games or entire draft; SeasonDashboard + league schedule view)
