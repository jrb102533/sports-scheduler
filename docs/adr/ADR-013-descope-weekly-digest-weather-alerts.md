# ADR-013 — Descope sendWeeklyDigest and checkWeatherAlerts

**Status:** Accepted
**Date:** 2026-04-26
**Deciders:** PM + Architect
**Jira:** FW-82, FW-86

---

## Context

As part of the FW-82 notification-architecture refactor, we reviewed which scheduled Cloud Functions were worth migrating to the new denormalized-recipient model and which should be removed entirely.

`sendWeeklyDigest` and `checkWeatherAlerts` were both identified as candidates for descoping rather than migration.

---

## Decision

### `sendWeeklyDigest` — deleted, not migrated

The weekly digest wrote in-app `AppNotification` documents for every player/parent on every team that had an event in the coming week. At the time it was built, there was no in-app notification UI to surface these. The feature was shipped speculatively.

Migration cost: high (would require the same recipient denormalization + a working in-app notification inbox).
Value: low (no UI, no user feedback that it is valued, email reminders already cover upcoming events more precisely via `sendScheduledNotifications`).

Decision: delete. Re-evaluate if a notification inbox is built.

### `checkWeatherAlerts` — deleted, not migrated

Weather alerts polled the Open-Meteo geocoding and forecast APIs every 6 hours for all outdoor events in the next 24 hours. Problems:

1. **Geocoding was unreliable on free-text location strings** — "Riverside Park field 3" geocodes inconsistently.
2. **No user configuration** — there was no way to opt out or set a threshold per team/event.
3. **Cost** — 6 CF invocations per day, each reading potentially many event docs and making 2 external API calls per event.
4. **Maintenance burden** — Open-Meteo API shape changes could silently break it.

The feature was useful in concept but the implementation was fragile and not worth migrating without a proper venue coordinates pipeline and user opt-in UX.

Decision: delete. Re-evaluate when venue lat/lng coverage is high and user opt-in UX exists.

---

## Consequences

- Both CFs are deleted from `functions/src/index.ts` as of Phase D (FW-86).
- The corresponding Cloud Scheduler jobs auto-delete on the next `firebase deploy --only functions`.
- No data migration required — `weatherAlertSent` field on event docs can remain (harmless).
- `AppNotification` documents written by the old `sendWeeklyDigest` remain in Firestore (visible if an inbox UI is built later).

---

## Related

- **ADR-012** — Cost discipline architecture (the parent decision)
- **FW-82** — Full notification architecture epic
- **PR #646** — Phase D cutover (deletes these CFs)
