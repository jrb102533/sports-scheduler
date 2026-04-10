/**
 * Firestore security rules — SEC-36, SEC-48, SEC-49, SEC-50
 *
 * SEC-36: The coach branch of the teams update rule must exclude leagueIds
 *         and _managedLeagueId from the set of fields a coach may modify.
 *         Coaches must not be able to self-assign their team to a league.
 *
 * SEC-48: Player create/delete must be scoped to coaches of the player's
 *         specific team, not all coaches platform-wide.
 *
 * SEC-49: The sensitiveData subcollection (DOB, parentContact, emergencyContact)
 *         must be readable only by coaches of the specific team, not all coaches.
 *
 * SEC-50: collectionGroup('sensitiveData') queries must apply the same
 *         team-scoped check.
 *
 * ── Why emulator tests are not used ──────────────────────────────────────────
 * Same as firestore.rules.teamLeagueAssign.test.ts — no @firebase/rules-unit-
 * testing infrastructure in this project. These tests exercise the rule LOGIC
 * (the boolean conditions) in isolation. Convert to assertSucceeds/assertFails
 * emulator calls when the infrastructure gap is closed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from 'vitest';

// ─── Rule-logic helpers (mirrors firestore.rules semantics) ──────────────────

/**
 * isCoachOfTeam(teamData, callerUid)
 * Mirrors the rule helper:
 *   function isCoachOfTeam(teamData) {
 *     return teamData.coachId == request.auth.uid
 *       || (teamData.keys().hasAll(['coachIds']) && teamData.coachIds.hasAny([request.auth.uid]));
 *   }
 */
function isCoachOfTeam(teamData: { coachId?: string; coachIds?: string[] }, callerUid: string): boolean {
  return (
    teamData.coachId === callerUid ||
    (Array.isArray(teamData.coachIds) && teamData.coachIds.includes(callerUid))
  );
}

/**
 * coachUpdateAllowed(currentData, incomingDiff, callerUid)
 *
 * Mirrors the coach branch of the teams update rule (post-SEC-36):
 *   allow update: if ...
 *     || (
 *       isCoachOfTeam(resource.data)
 *       && !request.resource.data.diff(resource.data).affectedKeys()
 *           .hasAny(['coachIds', 'coachId', 'createdBy', 'leagueIds', '_managedLeagueId'])
 *     )
 */
function coachUpdateAllowed(
  teamData: { coachId?: string; coachIds?: string[] },
  affectedKeys: string[],
  callerUid: string,
): boolean {
  const forbidden = ['coachIds', 'coachId', 'createdBy', 'leagueIds', '_managedLeagueId'];
  return (
    isCoachOfTeam(teamData, callerUid) &&
    !affectedKeys.some(k => forbidden.includes(k))
  );
}

/**
 * playerReadAllowed(playerData, teamData, callerUid, callerTeamId)
 *
 * Mirrors the players read rule (post-SEC-48/50):
 *   allow read: if request.auth != null && (
 *     isAdmin() ||
 *     resource.data.linkedUid == request.auth.uid ||
 *     isCoachOfTeam(get(/...teams/teamId).data) ||
 *     getProfile().teamId == resource.data.teamId
 *   );
 *
 * We exercise the isCoachOfTeam path specifically.
 */
function playerReadAllowed(
  playerData: { teamId: string; linkedUid?: string },
  teamData: { coachId?: string; coachIds?: string[] },
  callerUid: string,
  isAdmin: boolean,
  callerTeamId?: string,
): boolean {
  return (
    isAdmin ||
    playerData.linkedUid === callerUid ||
    isCoachOfTeam(teamData, callerUid) ||
    callerTeamId === playerData.teamId
  );
}

/**
 * sensitiveDataReadAllowed(sensitiveDoc, teamData, callerUid)
 *
 * Mirrors both the nested sensitiveData match and the collectionGroup rule
 * (post-SEC-49):
 *   allow read: if isAdmin()
 *     || isCoachOfTeam(get(/...teams/teamId).data);
 */
function sensitiveDataReadAllowed(
  teamData: { coachId?: string; coachIds?: string[] },
  callerUid: string,
  isAdmin: boolean,
): boolean {
  return isAdmin || isCoachOfTeam(teamData, callerUid);
}

/**
 * sensitiveDataWriteAllowed(sensitiveDoc, teamData, callerUid)
 *
 * Mirrors:
 *   allow write: if isAdmin()
 *     || isCoachOfTeam(get(/...teams/teamId).data);
 */
function sensitiveDataWriteAllowed(
  teamData: { coachId?: string; coachIds?: string[] },
  callerUid: string,
  isAdmin: boolean,
): boolean {
  return isAdmin || isCoachOfTeam(teamData, callerUid);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const teamA = { id: 'team-a', coachId: 'uid-coach-a', coachIds: ['uid-coach-a'] };
const teamB = { id: 'team-b', coachId: 'uid-coach-b', coachIds: ['uid-coach-b'] };

const coachA = 'uid-coach-a';
const coachB = 'uid-coach-b';
const unrelatedCoach = 'uid-coach-unrelated';
const adminUid = 'uid-admin';
const playerLinkedUid = 'uid-player-self';

const playerDocInTeamA = { teamId: teamA.id, linkedUid: playerLinkedUid };

// =============================================================================
// SEC-36: Coach cannot write leagueIds or _managedLeagueId
// =============================================================================

describe('SEC-36 — coach branch must deny writes touching leagueIds or _managedLeagueId', () => {
  /**
   * Emulator equivalent:
   *   const db = testEnv.authenticatedContext(coachA, { role: 'coach' });
   *   await assertFails(db.collection('teams').doc(teamA.id).update({
   *     leagueIds: ['league-x'], name: 'Thunder'  // <-- leagueIds forbidden
   *   }));
   */
  it('denies a coach who attempts to modify leagueIds', () => {
    const allowed = coachUpdateAllowed(teamA, ['name', 'leagueIds'], coachA);
    expect(allowed).toBe(false);
  });

  it('denies a coach who attempts to modify _managedLeagueId', () => {
    const allowed = coachUpdateAllowed(teamA, ['name', '_managedLeagueId'], coachA);
    expect(allowed).toBe(false);
  });

  it('denies a coach who attempts to modify only leagueIds (no other fields)', () => {
    const allowed = coachUpdateAllowed(teamA, ['leagueIds'], coachA);
    expect(allowed).toBe(false);
  });

  it('denies a coach who attempts to modify only _managedLeagueId', () => {
    const allowed = coachUpdateAllowed(teamA, ['_managedLeagueId'], coachA);
    expect(allowed).toBe(false);
  });

  it('denies a coach who attempts to modify both leagueIds and _managedLeagueId together', () => {
    // This is the typical LM write pattern — a coach must never pass this check.
    const allowed = coachUpdateAllowed(teamA, ['leagueIds', '_managedLeagueId'], coachA);
    expect(allowed).toBe(false);
  });

  /**
   * Emulator equivalent:
   *   await assertSucceeds(db.collection('teams').doc(teamA.id).update({ name: 'Thunder' }));
   */
  it('allows a coach of the team to update safe fields (name, color, etc.)', () => {
    const allowed = coachUpdateAllowed(teamA, ['name', 'color'], coachA);
    expect(allowed).toBe(true);
  });

  it('allows a coach in coachIds[] to update safe fields', () => {
    const team = { coachId: 'uid-someone-else', coachIds: [coachA, 'uid-other'] };
    const allowed = coachUpdateAllowed(team, ['homeVenue', 'coachName'], coachA);
    expect(allowed).toBe(true);
  });

  it('still denies coachIds and coachId (pre-existing SEC-29 restriction)', () => {
    const allowed = coachUpdateAllowed(teamA, ['coachIds'], coachA);
    expect(allowed).toBe(false);
  });

  it('denies a user who is not a coach of the team even for safe fields', () => {
    const allowed = coachUpdateAllowed(teamA, ['name'], unrelatedCoach);
    expect(allowed).toBe(false);
  });
});

// =============================================================================
// SEC-48: Player read/write scoped to coaches of the specific team
// =============================================================================

describe('SEC-48 — player read scoped to team coach, not all coaches', () => {
  /**
   * Emulator equivalent:
   *   const db = testEnv.authenticatedContext(coachA, { role: 'coach' });
   *   await assertSucceeds(db.collection('players').doc(playerId).get());
   *   // where player.teamId === teamA.id and coachA is teamA's coach
   */
  it('allows a coach of the player\'s team to read the player doc', () => {
    const allowed = playerReadAllowed(playerDocInTeamA, teamA, coachA, false);
    expect(allowed).toBe(true);
  });

  /**
   * Emulator equivalent:
   *   const db = testEnv.authenticatedContext(coachB, { role: 'coach' });
   *   await assertFails(db.collection('players').doc(playerId).get());
   *   // player.teamId === teamA.id but coachB is only a coach of teamB
   */
  it('denies a coach of a DIFFERENT team from reading the player doc', () => {
    // coachB is a valid coach but only of teamB, not teamA
    const allowed = playerReadAllowed(playerDocInTeamA, teamA, coachB, false);
    expect(allowed).toBe(false);
  });

  it('denies an unrelated coach from reading the player doc', () => {
    const allowed = playerReadAllowed(playerDocInTeamA, teamA, unrelatedCoach, false);
    expect(allowed).toBe(false);
  });

  it('allows a player to read their own linked player doc (linkedUid match)', () => {
    const allowed = playerReadAllowed(playerDocInTeamA, teamA, playerLinkedUid, false);
    expect(allowed).toBe(true);
  });

  it('allows a team member (same teamId on profile) to read the player doc', () => {
    const allowed = playerReadAllowed(playerDocInTeamA, teamA, 'uid-teammate', false, teamA.id);
    expect(allowed).toBe(true);
  });

  it('admin can always read any player doc', () => {
    const allowed = playerReadAllowed(playerDocInTeamA, teamA, adminUid, true);
    expect(allowed).toBe(true);
  });
});

describe('SEC-48 — player create/delete scoped to team coach', () => {
  /**
   * These mirror the create and delete arms of the player rule.
   * The logic is identical to isCoachOfTeam() applied to the target team.
   */
  it('allows coach of the team to create a player on that team', () => {
    // create: isCoachOfTeam(get(teams/teamId).data) — using teamId from request.resource.data
    const allowed = isCoachOfTeam(teamA, coachA);
    expect(allowed).toBe(true);
  });

  it('denies a coach of a different team from creating a player on teamA', () => {
    const allowed = isCoachOfTeam(teamA, coachB);
    expect(allowed).toBe(false);
  });

  it('allows coach of the team to delete a player on that team', () => {
    // delete: isCoachOfTeam(get(teams/teamId).data) — using teamId from resource.data
    const allowed = isCoachOfTeam(teamA, coachA);
    expect(allowed).toBe(true);
  });

  it('denies a coach of a different team from deleting a player on teamA', () => {
    const allowed = isCoachOfTeam(teamA, coachB);
    expect(allowed).toBe(false);
  });
});

// =============================================================================
// SEC-49: sensitiveData subcollection scoped to team coach
// =============================================================================

describe('SEC-49 — sensitiveData read restricted to coach of the specific team', () => {
  /**
   * Emulator equivalent:
   *   const db = testEnv.authenticatedContext(coachA, { role: 'coach' });
   *   await assertSucceeds(
   *     db.collection('players').doc(playerId).collection('sensitiveData').doc('pii').get()
   *   );
   *   // where player.teamId === teamA.id and coachA is in teamA.coachIds
   */
  it('allows a coach of the player\'s team to read sensitiveData', () => {
    const allowed = sensitiveDataReadAllowed(teamA, coachA, false);
    expect(allowed).toBe(true);
  });

  /**
   * Emulator equivalent:
   *   const db = testEnv.authenticatedContext(coachB, { role: 'coach' });
   *   await assertFails(
   *     db.collection('players').doc(playerId).collection('sensitiveData').doc('pii').get()
   *   );
   *   // coachB is a real coach but only of teamB — must be denied cross-team PII access
   */
  it('denies a coach of a DIFFERENT team from reading sensitiveData', () => {
    // coachB is not in teamA.coachIds or teamA.coachId
    const allowed = sensitiveDataReadAllowed(teamA, coachB, false);
    expect(allowed).toBe(false);
  });

  it('denies an unrelated coach from reading sensitiveData', () => {
    const allowed = sensitiveDataReadAllowed(teamA, unrelatedCoach, false);
    expect(allowed).toBe(false);
  });

  it('admin can read sensitiveData for any team', () => {
    const allowed = sensitiveDataReadAllowed(teamA, adminUid, true);
    expect(allowed).toBe(true);
  });

  it('parent/player role (not a coach of the team) cannot read sensitiveData', () => {
    // A parent is not a coach — isCoachOfTeam returns false, and they're not admin
    const allowed = sensitiveDataReadAllowed(teamA, 'uid-parent', false);
    expect(allowed).toBe(false);
  });
});

describe('SEC-49 — sensitiveData write restricted to coach of the specific team', () => {
  it('allows a coach of the team to write to sensitiveData', () => {
    const allowed = sensitiveDataWriteAllowed(teamA, coachA, false);
    expect(allowed).toBe(true);
  });

  it('denies a coach of a different team from writing to sensitiveData', () => {
    const allowed = sensitiveDataWriteAllowed(teamA, coachB, false);
    expect(allowed).toBe(false);
  });

  it('allows admin to write to sensitiveData', () => {
    const allowed = sensitiveDataWriteAllowed(teamA, adminUid, true);
    expect(allowed).toBe(true);
  });
});

// =============================================================================
// SEC-50: collectionGroup('sensitiveData') — same team-scoped restriction
// =============================================================================

describe('SEC-50 — collectionGroup sensitiveData inherits team-scoped check', () => {
  /**
   * The collectionGroup rule uses the same isCoachOfTeam() predicate.
   * The key risk is that a previous rule used broad isCoach() which would
   * have allowed ANY authenticated coach to read ALL sensitiveData docs
   * platform-wide via a collectionGroup query.
   *
   * Emulator equivalent:
   *   const db = testEnv.authenticatedContext(coachB, { role: 'coach' });
   *   await assertFails(
   *     db.collectionGroup('sensitiveData').where('teamId', '==', teamA.id).get()
   *   );
   */
  it('collectionGroup read: coach of a different team is denied', () => {
    // The collectionGroup rule fetches the team doc and calls isCoachOfTeam.
    // coachB is not a coach of teamA.
    const allowed = sensitiveDataReadAllowed(teamA, coachB, false);
    expect(allowed).toBe(false);
  });

  it('collectionGroup read: coach of the same team is allowed', () => {
    const allowed = sensitiveDataReadAllowed(teamA, coachA, false);
    expect(allowed).toBe(true);
  });

  it('collectionGroup write: coach of a different team is denied', () => {
    const allowed = sensitiveDataWriteAllowed(teamA, coachB, false);
    expect(allowed).toBe(false);
  });

  it('collectionGroup write: admin is allowed', () => {
    const allowed = sensitiveDataWriteAllowed(teamA, adminUid, true);
    expect(allowed).toBe(true);
  });

  /**
   * Escalation probe: a coach who is on both teamA and teamB may query
   * sensitiveData for their own teams but not for teamC they do not coach.
   */
  it('collectionGroup: multi-team coach allowed for own team, denied for team they do not coach', () => {
    const multiTeamCoach = 'uid-multi-coach';
    const teamWithMultiCoach = { coachId: 'uid-primary', coachIds: [multiTeamCoach, 'uid-primary'] };
    const teamWithoutMultiCoach = { coachId: 'uid-different', coachIds: ['uid-different'] };

    expect(sensitiveDataReadAllowed(teamWithMultiCoach, multiTeamCoach, false)).toBe(true);
    expect(sensitiveDataReadAllowed(teamWithoutMultiCoach, multiTeamCoach, false)).toBe(false);
  });
});

// =============================================================================
// isCoachOfTeam helper — edge cases
// =============================================================================

describe('isCoachOfTeam — edge cases', () => {
  it('returns true when caller matches coachId scalar', () => {
    expect(isCoachOfTeam({ coachId: 'uid-a' }, 'uid-a')).toBe(true);
  });

  it('returns true when caller appears in coachIds array', () => {
    expect(isCoachOfTeam({ coachIds: ['uid-a', 'uid-b'] }, 'uid-b')).toBe(true);
  });

  it('returns false when coachId does not match and coachIds is absent', () => {
    expect(isCoachOfTeam({ coachId: 'uid-other' }, 'uid-a')).toBe(false);
  });

  it('returns false when coachIds is empty', () => {
    expect(isCoachOfTeam({ coachIds: [] }, 'uid-a')).toBe(false);
  });

  it('returns false when both coachId and coachIds are absent', () => {
    expect(isCoachOfTeam({}, 'uid-a')).toBe(false);
  });

  it('returns false when coachIds is present but caller is not in it', () => {
    expect(isCoachOfTeam({ coachIds: ['uid-other'] }, 'uid-a')).toBe(false);
  });
});
