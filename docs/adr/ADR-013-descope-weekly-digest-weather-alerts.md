# ADR-013 — Descope: Weekly Digest and Weather Alerts

**Status:** Accepted
**Date:** 2026-04-26
**Deciders:** PM + Architect
**Jira:** FW-82 (parent epic), FW-86 (deletion subtask)

---

## Decision

Two scheduled Cloud Functions are **descoped from the product** and will be deleted (not migrated, not deferred):

1. **`sendWeeklyDigest`** — Monday 7am LM-facing weekly summary email
2. **`checkWeatherAlerts`** — every-6-hour venue weather check + alert email for upcoming events

These features are not part of First Whistle's current product surface. Code, scheduled jobs, and any UI references will be removed in FW-86 (the same PR that cuts over to the new dispatcher CF architecture).

---

## Context

The cost-discipline audit on 2026-04-26 found 9 scheduled CFs running on staging burning ~57K Firestore reads/day from fanout-style recipient resolution. The audit also surfaced that some of those CFs may not deliver active product value:

- **Weekly Digest** is a "nice to have" LM summary that has minimal current LM usage (no metrics suggest it's being read), and overlaps significantly with the day-before/game-day reminders that LMs already get.
- **Weather Alerts** are the most expensive CF in the bunch (every 6 hours, reads all upcoming events × all venues × external weather API calls). The feature was speculative — it depends on venue geocoding and an active weather-alert UI integration that has not materialized.

Rather than spend engineering effort migrating these to the new denormalized + consolidated architecture (FW-82), we cut them.

---

## Why delete instead of defer

- **Defer rots into permanent dead code.** Every "we'll get back to this later" CF that survives a year accumulates technical debt: schema dependencies, env-var guards, scheduler config, test fixtures.
- **Cost is real, even when guarded.** The env-guard from ADR-012 stops the per-invocation reads, but the function image still deploys, the scheduler job still exists, and any code path depending on the CF still has to be maintained.
- **Re-adding is cheap if needed.** If we decide to bring weekly digest back later, it'll be a clean greenfield design against the new dispatcher architecture, not a port of legacy fanout code.
- **Honest scoping.** The product surface should reflect what the product actually does. Two CFs that fire reminders nobody reads is not a feature.

---

## Consequences

### Positive

- Reduces the scheduled-CF inventory from 9 to 7 (then to 4 after the FW-82 consolidation completes).
- Cuts the every-6-hour weather check immediately — the largest single read source per cron tick.
- Removes the speculative dependency on venue geocoding being complete and accurate.
- Less code to migrate to the new dispatcher; FW-82 ships sooner.

### Negative

- Any LM who was actively using the Monday digest loses it. Mitigation: zero-user impact in production today (no active LMs in prod per `project_stripe_prod_rollout.md`). For staging test LMs, the in-app dashboard surfaces the same data.
- If we re-add either feature later, it needs greenfield design + tests rather than a refactor of existing code. Acceptable trade-off — see "Why delete" above.

### Migration

- FW-86 deletes both CFs as part of the cut-over PR. No separate migration step needed.
- The corresponding Cloud Scheduler jobs (`firebase-schedule-sendWeeklyDigest-us-central1`, `firebase-schedule-checkWeatherAlerts-us-central1`) get auto-deleted by `firebase deploy` when the function exports are removed. No manual cleanup needed.

---

## Related

- **ADR-012** — Cost discipline architecture (the env-var guards that bandaided the cost issue)
- **FW-82** — Notification architecture epic that consolidates remaining 4 reminder CFs into 1 dispatcher
- **FW-86** — Cut-over subtask that includes deleting these 2 CFs alongside replacing the other 4
