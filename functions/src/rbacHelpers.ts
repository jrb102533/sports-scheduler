/**
 * RBAC helper functions for Cloud Function ownership assertions.
 *
 * Both helpers check the Phase 2 denormalized access-list arrays first.
 * They fall back to legacy scalar fields for documents that have not yet
 * been backfilled (i.e. pre-Phase-1 documents still in Firestore).
 */

/**
 * Returns true if uid is a coach of the given team.
 * Checks the Phase 2 coachIds array first; falls back to legacy coachId /
 * createdBy scalars for docs not yet backfilled.
 */
export function isCoachOfTeamDoc(
  teamData: Record<string, unknown>,
  uid: string
): boolean {
  const ids = teamData['coachIds'];
  if (Array.isArray(ids)) {
    // Array present (even if empty) → authoritative; do not fall back to legacy scalars.
    return ids.includes(uid);
  }
  // Array absent → doc not yet backfilled; use legacy scalars.
  return teamData['coachId'] === uid || teamData['createdBy'] === uid;
}

/**
 * Returns true if uid is a manager of the given league.
 * Checks the Phase 2 managerIds array first; falls back to legacy managedBy
 * scalar for docs not yet backfilled.
 */
export function isManagerOfLeagueDoc(
  leagueData: Record<string, unknown>,
  uid: string
): boolean {
  const ids = leagueData['managerIds'];
  if (Array.isArray(ids)) {
    // Array present (even if empty) → authoritative; do not fall back to legacy scalars.
    return ids.includes(uid);
  }
  // Array absent → doc not yet backfilled; use legacy scalar.
  return leagueData['managedBy'] === uid;
}
