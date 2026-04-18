# First Whistle — Change Control Policy
**Version:** 1.0
**Last updated:** 2026-04-09
**Owner:** Product Manager
**Status:** Active

---

## 1. Purpose

This document defines how code changes, configuration changes, and data migrations move from development through to production. It exists so that every person (and agent) working on First Whistle knows what gates apply to their change and can't accidentally skip them.

---

## 2. Branch Strategy

| Branch | Purpose | Lifetime |
|---|---|---|
| `main` | Production-ready code | Permanent — protected |
| `feature/<description>` | New features | Per feature — delete after merge |
| `fix/<description>` | Bug fixes | Per fix — delete after merge |
| `chore/<description>` | Housekeeping, deps, config | Per task — delete after merge |
| `hotfix/<description>` | Active outage or data breach only | Short-lived — merge to main within 24h |

**Rules:**
- Never commit directly to `main`
- One branch per session / per logical unit of work
- Branch names are lowercase, hyphen-separated
- Delete branches after merge — do not accumulate stale branches

---

## 3. Pull Request Requirements

Every PR must satisfy all of the following before it is marked ready for review:

### 3.1 All PRs
- [ ] CI is green (build + unit tests pass)
- [ ] `npm run build` passes with no TypeScript errors
- [ ] PR description explains *what* changed and *why* (not just what the diff shows)
- [ ] Any new scripts or operational procedures are documented in `docs/RUNBOOK.md`

### 3.2 PRs touching application logic
- [ ] **QA agent (`qa-test-engineer`) has run** — mandatory before every PR; no exceptions
- [ ] Tests exist for every affected role (not just the happy path)
- [ ] No new `waitForTimeout` hard waits added to E2E tests

### 3.3 PRs touching security-sensitive areas
The following changes require the **security engineer agent** to review before merge:
- `firestore.rules` (any change — highest blast radius; a permissive rule takes effect instantly)
- Cloud Functions that handle auth, RSVP tokens, HMAC signing, or user data
- Any change to role assignment, permission checks, or access control logic

### 3.4 PRs touching `firestore.rules`
- Security engineer agent review is **blocking** (not advisory)
- Rules changes must include corresponding `@firebase/rules-unit-testing` tests
- Changes take effect immediately on deploy — no staged rollout possible

### 3.5 PRs touching Cloud Function secrets or environment config
- New secrets must be documented in `docs/PRD.md §9` (Open Blockers) until provisioned
- Secret names must follow the existing convention (`SCREAMING_SNAKE_CASE`)
- Never hardcode environment-specific values — all config via `defineSecret` or env vars

---

## 4. Merge Gates

Branch protection on `main` enforces:
- PR required (no direct push)
- At least 1 approval required
- CI must pass before merge
- No force-push permitted

**Squash merge is the default** — keeps `main` history linear and readable.

---

## 5. Deployment Pipeline

```
feature branch
    ↓  (PR + review + CI green)
main
    ↓  (automated: Deploy to Firebase workflow triggers)
staging  ←── E2E suite runs automatically after deploy
    ↓  (manual: Release workflow, requires human approval gate)
production
```

### 5.1 Staging deploys
- Triggered automatically on every merge to `main`
- Staging E2E suite runs after deploy and posts results to the merged PR
- CLI staging deploys (`firebase deploy --project staging`) are permitted for hotfix testing

### 5.2 Production deploys
- **Never deploy to production from the CLI** — always via the `release.yml` GitHub Actions workflow
- The workflow runs a programmatic **smoke gate** (`smoke-gate` job) that verifies the `E2E Smoke — Staging` workflow passed for the exact SHA being deployed before the deploy job can proceed — see `docs/TESTING_TIERS.md` for the full tier model
- The workflow pauses at a `environment: production` gate for human approval
- No production deploy without a merged PR

### 5.3 Deploy targets
All four deploy targets require a merged PR:
- `hosting`
- `functions`
- `firestore:rules`
- `firestore:indexes`

---

## 6. Hotfix Process (Active Outage or Data Breach Only)

A hotfix bypasses the normal staging-first flow. Valid triggers: production is down, or data is actively leaking. "We want to test in prod" is not a valid trigger.

1. Push the fix branch to remote immediately
2. Open a PR and get it **approved** (not just opened) before deploying
3. Deploy from the branch (`firebase deploy --project production --only <target>`)
4. Merge the PR to `main` within 24 hours post-incident
5. Document the bypass reason in the PR body

---

## 7. Rollback Procedure

### Frontend / hosting rollback
Firebase Hosting keeps the last 10 deploys. Roll back via:
```bash
firebase hosting:releases:list --project production
firebase hosting:rollback --project production
```

### Cloud Functions rollback
Redeploy the previous version from the last known-good commit:
```bash
git checkout <last-good-sha> -- functions/src/
git commit -m "chore: revert functions to <sha>"
# Open PR → merge → deploy via release workflow
```

### Firestore rules rollback
`firestore.rules` is versioned in git. Revert the file and redeploy via PR.

### Data rollback
Firestore has no built-in point-in-time restore on the Spark plan. For destructive data changes (migrations, bulk deletes), take a manual export before running:
```bash
gcloud firestore export gs://<bucket>/backups/$(date +%Y%m%d) --project production
```

---

## 8. Data Migrations and Backfill Scripts

Scripts in `scripts/*.mjs` that mutate Firestore data require additional care:

| Step | Requirement |
|---|---|
| Before running | Take a Firestore export (see §7) |
| Authorisation | PM must approve before running against production |
| Idempotency | Script must be safe to re-run (check `docs/RUNBOOK.md` entry) |
| Verification | Run against staging first; confirm output before production |
| Record | Note the run date and outcome in the relevant GitHub issue or PR |

See `docs/RUNBOOK.md` for per-script operating procedures.

---

## 9. Agent Roles and Review Authority

| Agent | When to invoke | Blocking? |
|---|---|---|
| `qa-test-engineer` | Before every PR | Yes — hard rule |
| `security-engineer` | PRs touching rules, auth, HMAC, access control | Yes — hard rule |
| `frontend-developer` | React/TypeScript UI implementation | No |
| `backend-developer` | Cloud Functions, Firestore data model | No |
| `ux-cx-designer` | UI/UX reviews, design decisions | No |

The Product Manager's decision always takes precedence over any agent recommendation. Agents flag conflicts and consequences — they do not override PM direction.

---

## 10. What This Policy Does Not Cover

- Feature prioritisation — see `docs/BACKLOG.md`
- Architectural decisions — see `docs/adr/`
- Operational procedures (scripts, maintenance) — see `docs/RUNBOOK.md`
- Product requirements — see `docs/PRD.md`
