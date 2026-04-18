# First Whistle — Testing Tier Model

**Version:** 1.0
**Last updated:** 2026-04-18
**Owner:** Engineering

---

## Overview

First Whistle uses a four-tier testing model designed to maximise defect coverage while keeping CI costs close to zero for the early soft-launch period. Each tier runs at a different point in the delivery pipeline and is optimised for a distinct failure category.

---

## Tier Summary

| Tier | What | When | Cost |
|---|---|---|---|
| T1 — Always | Unit + Emulator E2E (12 @emu specs) + Firestore rules emulator tests | Every PR push | $0 |
| T2 — Post-deploy smoke | @smoke Playwright suite against staging | After every successful staging deploy | Low |
| T3 — Pre-prod-deploy smoke gate | Verify T2 passed on the SHA being deployed | Programmatic check during `release.yml` | $0 (API call only) |
| T4 — Manual full | Full staging E2E suite | On-demand via `workflow_dispatch` | Per-run |

---

## Tier Details

### T1 — Always (Every PR Push)

**Workflow files:** `ci.yml`, `e2e-emulator.yml`

**What runs:** Vitest unit tests for frontend and Cloud Functions, the 12 Playwright specs tagged `@emu` (run against the Firebase Emulator Suite), and `@firebase/rules-unit-testing` Firestore security-rules tests.

**Trigger:** Every push to any open PR, via `on: pull_request`.

**Cost:** $0. All execution is local to the runner — no external Firebase project is touched, no Playwright browser is spun against a live URL.

**Failure modes caught:** Logic bugs in pure functions and store reducers; Cloud Function business-logic regressions; Firestore security-rule changes that break allowed access or fail to block denied access; TypeScript compilation errors.

**Failure modes NOT caught:** Regressions that only manifest against real Firebase (auth flows, deployed Cloud Functions, network-layer timing); visual/layout issues; cross-role access paths that involve real deployed rules. These are deferred to T2.

---

### T2 — Post-Deploy Smoke (After Every Staging Deploy)

**Workflow file:** `e2e-smoke.yml`

**What runs:** The Playwright specs tagged `@smoke` (~9 specs), executed against the live staging environment (`first-whistle-e76f4.web.app`) using real Firebase Auth, Firestore, and deployed Cloud Functions.

**Trigger:** `on: workflow_run` — fires automatically after the `Deploy to Firebase` workflow completes successfully on `main`. Results are posted as a comment on the merged PR.

**Cost:** Low. One Playwright run on a GitHub-hosted runner, billed at standard Actions minutes. No Firestore reads beyond what the smoke scenarios exercise.

**Failure modes caught:** Regressions in critical user journeys (login, auth-gated pages, role access); Cloud Function deployment failures that surface at runtime; Firestore rule changes that break the app for real users; environment-specific config errors.

**Failure modes NOT caught:** Edge cases and non-smoke paths; regressions in roles or flows not covered by `@smoke` tags; issues that only appear under load.

---

### T3 — Pre-Prod-Deploy Smoke Gate (During Release)

**Workflow file:** `release.yml` — `smoke-gate` job

**What runs:** A single shell step that calls the GitHub Actions API (`gh run list`) to query whether the `E2E Smoke — Staging` workflow ran for the exact commit SHA being released, and whether it concluded with `success`. No Playwright browser is launched; no Firebase project is touched.

**Trigger:** Runs automatically inside `release.yml` before the `deploy` job. The `deploy` job declares `needs: [smoke-gate]` so it cannot proceed if `smoke-gate` fails.

**Cost:** $0. One GitHub API call. No runner minutes beyond the `smoke-gate` job itself (seconds).

**Failure modes caught:**
- A human approving a production deploy before staging smoke has finished running.
- A human approving a production deploy after staging smoke explicitly failed (e.g. approving to "just try it in prod").
- Smoke having never run for the SHA (e.g. the staging deploy was skipped or the workflow was broken).

**Failure behaviour:** The gate fails fast — it does not poll or sleep. If smoke is still `in_progress` or `queued`, the gate exits with a clear message instructing the operator to re-run the Release workflow once smoke completes. If smoke concluded with anything other than `success`, the gate exits with the smoke run URL embedded so the operator can investigate immediately. The deploy job is never reached in either case.

**Failure modes NOT caught:** Bugs introduced between the staging deploy and the production deploy (T3 only verifies the smoke result, not re-runs it). This window is accepted as acceptable risk at the current scale.

---

### T4 — Manual Full Suite (On-Demand)

**Workflow file:** `e2e-full.yml`

**What runs:** The complete Playwright staging E2E suite — all specs across all roles.

**Trigger:** `on: workflow_dispatch` only. No cron, no automatic trigger. An engineer or the PM manually dispatches this from the Actions tab.

**Cost:** Per-run. A full Playwright suite takes meaningful runner minutes and exercises the live staging environment extensively. Dispatch deliberately rather than automatically to keep costs controlled during the soft-launch period.

**Failure modes caught:** Every role-based access boundary; every user journey; edge cases not covered by `@smoke`; regressions in low-frequency flows.

**When to run:** Before a significant release, after a large refactor, when investigating a suspected broad regression, or when the PM wants full confidence before a go-live milestone.

---

## Cross-references

- CI workflow files: `.github/workflows/`
- Deploy pipeline and approval gates: `docs/CHANGE_CONTROL.md §5`
- Smoke test scenario list: `docs/SMOKE_TEST.md`
- Runbook for smoke failures: `docs/RUNBOOK.md`
