# ADR-012 — Cost Discipline Architecture

**Status:** Accepted
**Date:** 2026-04-26
**Deciders:** PM + Architect
**Jira:** FW-80 (E2E redesign), FW-81 (env-var skip)

---

## Context

On 2026-04-26 we discovered staging Firestore reads exceeding 200K/day with no real users. Root-cause audit found three independent waste vectors:

1. **9 scheduled Cloud Functions ran on staging identical to prod** — fanning out reads to build email recipient lists that go nowhere
2. **`deploy.yml` redeployed everything on every `main` push** — even docs-only PRs triggered full functions redeploy, which Firebase silently re-creates Cloud Scheduler jobs as ENABLED
3. **No environment-aware code** — same logic in two contexts, only one of which has real users

Each waste vector recurred after bandaid fixes (e.g., manual `gcloud scheduler jobs pause`) because nothing in the code prevented re-creation.

---

## Decision

**Three architectural rules locked.**

### Rule 1: Environment-aware scheduled CFs

Every `onSchedule(...)` Cloud Function MUST guard its handler with `ENV.shouldRunScheduledJobs()` from `functions/src/env.ts`. The default behaviour is:

- **Production** → run normally
- **Staging** → return early (no work, no reads) UNLESS `STAGING_ENABLE_SCHEDULES=true` is set on a specific test deploy
- **Emulator** → return early

Pattern:
```typescript
export const myJob = onSchedule(..., async () => {
  if (!ENV.shouldRunScheduledJobs()) {
    console.log('[myJob] skipped: scheduled jobs disabled');
    return;
  }
  // real work
});
```

The guard is in code, not in infra config. `firebase deploy` re-creating the Cloud Scheduler job has no effect — the function returns immediately.

### Rule 2: Path-scoped deploys

`deploy.yml` MUST detect what changed in each push and `firebase deploy --only <targets>` only those targets. Docs-only / legal-only / test-only PRs deploy nothing.

Path → target mapping:
| Path | Target |
|---|---|
| `functions/**`, `firebase.json` | functions |
| `src/**`, `index.html`, `vite.config.ts`, `tsconfig*.json`, `package*.json`, `public/**` | hosting |
| `firestore.rules`, `firestore.indexes.json` | firestore |
| `storage.rules` | storage |
| `extensions/**` | extensions |

If no targets match, the deploy step is skipped entirely. This stops needless function redeploys (and the cold-start init reads + scheduler re-creation that came with them).

### Rule 3: No auto-firing tests against live staging Firestore

Captured separately in `feedback_no_auto_test_runs.md` (memory) and PR #639 (workflow disabled). E2E suites that hit live staging Firestore are too expensive at scale; redesign tracked as FW-80.

---

## Consequences

### Positive

- **Staging reads drop to near-zero from idle scheduled jobs** (50-150K/day reclaimed)
- **70-80% of `main` pushes will skip the functions deploy entirely** — faster CI, lower function image churn, no scheduler re-creation
- **Pause-state survives deploys** — no need to remember to re-pause after every staging deploy
- **One env helper to rule them all** — `ENV.isStaging()` etc. avoids scattered string comparisons against `process.env.GCLOUD_PROJECT`
- **Production behaviour unchanged** — all guards default to "run normally" on prod

### Negative

- **First-time deploy of a new scheduled CF on staging needs explicit opt-in** to test it with `STAGING_ENABLE_SCHEDULES=true`. Acceptable trade-off — explicit > implicit cost.
- **Path filter complexity** — getting the filter list wrong means a code change might not deploy. Mitigated by clear path → target mapping table above; revisit when adding a new top-level directory.
- **Build jobs still always run** — only the deploy step is path-scoped. Builds are cheap (no Firestore reads), so this is fine; could be optimized later.

### Ongoing maintenance

- When adding a new `onSchedule(...)` function, the guard is mandatory. Reviewers/agents should reject PRs that omit it.
- When adding a new top-level source directory (e.g., `mobile/`), update the path filter mapping in `deploy.yml`.
- When adding a new deployable artifact type, update `firebase.json` AND the path filters together.

---

## Related

- **PR #639** — disabled E2E smoke workflow (auto-firing tests)
- **PR with this ADR** — adds `functions/src/env.ts`, guards 9 scheduled CFs, path-scopes `deploy.yml`
- **FW-80** — E2E redesign (move to emulator)
- **FW-81** — original tracking ticket for the env-var skip; this ADR is the realization
- **`feedback_no_auto_test_runs.md`** — hard rule on test workflows hitting staging
- **`project_staging_schedulers_paused.md`** — context on the pause + this fix
