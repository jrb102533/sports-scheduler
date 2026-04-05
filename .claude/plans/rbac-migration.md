# RBAC Migration Plan — Firestore Rules Phase 2

## Goal

Replace profile-read-based role checks (`getProfile().leagueId`, `resource.data.managedBy`)
with denormalized access-list checks (`coachIds`, `managerIds`) in `firestore.rules`.

Phase 1 (already shipped) backfilled `coachIds` on every `teams` doc and `managerIds` on every
`leagues` doc, and ensures these arrays are kept in sync by `createUserByAdmin` and
`backfillAccessControl`.

Phase 2 (this PR) rewrites the rules to use those fields, eliminating:
- The TOCTOU race (SEC-16): old rules read `profile.leagueId` at check time; if an LM is
  reassigned between read and write the check can pass incorrectly.
- The extra cross-doc profile read on every `/teams` and `/leagues` write.

## ⚠️ Deploy Warning

**This rules change MUST be deployed atomically with the Phase 1 Cloud Functions.**
If you deploy these rules before the Phase 1 CF is live, coaches/LMs who were assigned via
the legacy `coachId`/`managedBy` path (and whose docs do not yet have `coachIds`/`managerIds`)
will lose write access to their teams/leagues until a backfill runs.

**Deploy order:**
1. Deploy Cloud Functions (Phase 1 backfill + createUserByAdmin sync) — already shipped
2. Verify `coachIds`/`managerIds` arrays are present on all production docs (run backfill)
3. Deploy these updated Firestore rules

## New Helper Functions

```
// Resource-scoped helpers — no cross-doc profile read
function isCoachOfTeam(teamData) {
  return teamData.coachIds is list && teamData.coachIds.hasAny([request.auth.uid]);
}
function isManagerOfLeague(leagueData) {
  return leagueData.managerIds is list && leagueData.managerIds.hasAny([request.auth.uid]);
}
// Cross-doc read for subcollections (league {leagueId} not in scope)
function isManagerOfLeagueById(leagueId) {
  return get(/databases/$(database)/documents/leagues/$(leagueId)).data.managerIds.hasAny([request.auth.uid]);
}
```

## What Changes

| Path | Old check | New check |
|------|-----------|-----------|
| `/teams/{teamId}` update | `uid == createdBy \|\| uid == coachId \|\| (isLM && profile.leagueId matches)` | `isCoachOfTeam(resource.data) \|\| isManagerOfLeague(leagueDoc)` |
| `/teams/{teamId}/availability` write | `isCoach()` | `isCoachOfTeam(...)` via parent team doc |
| `/teams/{teamId}/joinRequests` read/update | `uid == createdBy \|\| uid == coachId` | `isCoachOfTeam(get(teams/teamId).data)` |
| `/leagues/{leagueId}` update | `isLM && (profile.leagueId == id \|\| managedBy == uid)` | `isManagerOfLeague(resource.data)` |
| `/leagues/{leagueId}/wizardDraft` | `isLM && profile.leagueId/managedBy` | `isManagerOfLeagueById(leagueId)` |
| `/leagues/{leagueId}/availabilityCollections` | `isLM && profile.leagueId/managedBy` | `isManagerOfLeagueById(leagueId)` |
| `/leagues/{leagueId}/fixtures` | `isLM && profile.leagueId` | `isManagerOfLeagueById(leagueId)` |
| `/leagues/{leagueId}/drafts` | `isLM && profile.leagueId` | `isManagerOfLeagueById(leagueId)` |
| `/leagues/{leagueId}/seasons` write | `isLM && profile.leagueId/managedBy` | `isManagerOfLeagueById(leagueId)` |
| `/leagues/{leagueId}/seasons/scheduleConfig` | `isLM && profile.leagueId/managedBy` | `isManagerOfLeagueById(leagueId)` |
| `/leagues/{leagueId}/divisions` write | `isLM && profile.leagueId/managedBy` | `isManagerOfLeagueById(leagueId)` |

## Unchanged Paths

- `/events` — no team/league resource to check against; keep `isCoach()`/`isLeagueManager()`
- `/players` — no denormalized access list on player docs; keep `isCoach()`
- `/invites` — read-only gating; keep `isCoach()`/`isLeagueManager()`
- `/users` — self-update path; unchanged
- `/opponents` — unchanged
- `/rateLimits`, `/system` — unchanged

## T1–T9 Test Matrix

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | Coach whose UID is in `coachIds` updates team name | ALLOW |
| T2 | Coach whose UID is NOT in `coachIds` updates team name | DENY |
| T3 | Coach tries to update `coachIds` field | DENY (SEC-29 field lock) |
| T4 | LM whose UID is in `managerIds` updates league name | ALLOW |
| T5 | LM whose UID is NOT in `managerIds` updates league name | DENY |
| T6 | LM tries to update `managerIds` field | DENY (SEC-29 field lock) |
| T7 | LM whose UID is in league `managerIds` reads/writes wizardDraft | ALLOW |
| T8 | Coach (not LM) tries to write wizardDraft | DENY |
| T9 | Admin updates team `coachIds` directly | ALLOW |
