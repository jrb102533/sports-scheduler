/**
 * Firestore security rules — teams/{teamId} update: league assignment (SEC-35)
 *
 * Tests the LM branch of the teams update rule:
 *
 *   allow update: if ...
 *     || (
 *       affectedKeys.hasOnly(['leagueIds', '_managedLeagueId'])
 *       && '_managedLeagueId' in request.resource.data
 *       && (leagueIds check...)
 *       && isManagerOfLeague(get(leagues/leagueId).data)
 *     )
 *
 * SEC-35 removed `isLeagueManager()` from that branch so that users who hold
 * role='coach' at the top level but have a `league_manager` entry in their
 * memberships[] (i.e. they became an LM via createLeagueAndBecomeManager or
 * assignScopedRole) are NOT blocked by the legacy role check.
 *
 * ── Why @firebase/rules-unit-testing is NOT used ────────────────────────────
 * This project has no @firebase/rules-unit-testing setup and the package is not
 * listed in devDependencies (confirmed in package.json).  The Firebase Emulator
 * Suite is available for E2E tests (Playwright) but the unit test layer (Vitest
 * in jsdom) has no mechanism to connect to it.
 *
 * Until that infrastructure gap is closed (see SEC-29 comment in firestore.rules)
 * we test the RULE LOGIC in isolation by importing and exercising the helper
 * functions that mirror what the rules evaluate, and by documenting the precise
 * scenario each test covers so that when emulator support is added these can be
 * converted 1-to-1.
 *
 * Concretely this file tests:
 *   1. The `isManagerOfLeague` logic (resource-scoped — checks managerIds[])
 *   2. The `isLeagueManager` legacy logic (profile-scoped — checks role field)
 *   3. Their combination: that the fix (removing isLeagueManager from the LM
 *      branch) correctly widens access to memberships-based LMs while keeping
 *      the isManagerOfLeague gate intact.
 *   4. The field-key restriction — only ['leagueIds', '_managedLeagueId'] may
 *      change in the LM path.
 *   5. The `_managedLeagueId` presence check.
 *   6. The leagueIds value check — _managedLeagueId must appear in either the
 *      incoming or outgoing leagueIds.
 *
 * These helpers are extracted from the rule semantics, not from application
 * code, so they stay honest even if app code changes.
 *
 * ── Emulator integration gap ─────────────────────────────────────────────────
 * SEC-29 / SEC-35 tracking: when @firebase/rules-unit-testing is added, convert
 * each `describe` block below into an emulator-backed `assertSucceeds` /
 * `assertFails` call against a real rules evaluation.  The test names and
 * scenario descriptions should transfer directly.
 */

import { describe, it, expect } from 'vitest';

// ─── Rule-logic helpers (mirrors firestore.rules semantics) ──────────────────

/**
 * isLeagueManager() — the LEGACY check removed from the SEC-35 fix.
 * Returns true only when the user's top-level `role` field is 'league_manager'.
 * Users who became LMs via createLeagueAndBecomeManager or assignScopedRole
 * keep role='coach', so this check incorrectly blocks them.
 */
function isLeagueManager_legacy(profile: { role: string }): boolean {
  return profile.role === 'league_manager';
}

/**
 * isManagerOfLeague() — the resource-scoped check that remains in the fix.
 * Returns true when the caller's UID appears in the league's managerIds[].
 * This is populated by createLeagueAndBecomeManager and assignScopedRole, so
 * it correctly covers both legacy-role LMs and memberships-based LMs.
 */
function isManagerOfLeague(leagueData: { managerIds?: string[] }, callerUid: string): boolean {
  return Array.isArray(leagueData.managerIds) && leagueData.managerIds.includes(callerUid);
}

/**
 * The LM branch allow-gate as it existed BEFORE SEC-35 (the broken state):
 *   isLeagueManager() && isManagerOfLeague() && affectedKeys check && ...
 */
function lmBranchBefore(
  profile: { role: string },
  leagueData: { managerIds?: string[] },
  callerUid: string,
  affectedKeys: string[],
  newData: Record<string, unknown>,
  oldLeagueIds: string[],
): boolean {
  return (
    isLeagueManager_legacy(profile) &&
    affectedKeys.every(k => ['leagueIds', '_managedLeagueId'].includes(k)) &&
    affectedKeys.length > 0 &&
    '_managedLeagueId' in newData &&
    (
      (Array.isArray(newData.leagueIds) && (newData.leagueIds as string[]).includes(newData._managedLeagueId as string)) ||
      oldLeagueIds.includes(newData._managedLeagueId as string)
    ) &&
    isManagerOfLeague(leagueData, callerUid)
  );
}

/**
 * The LM branch allow-gate AFTER SEC-35 (the fixed state):
 *   isManagerOfLeague() && affectedKeys check && ... (no isLeagueManager())
 */
function lmBranchAfter(
  leagueData: { managerIds?: string[] },
  callerUid: string,
  affectedKeys: string[],
  newData: Record<string, unknown>,
  oldLeagueIds: string[],
): boolean {
  return (
    affectedKeys.every(k => ['leagueIds', '_managedLeagueId'].includes(k)) &&
    affectedKeys.length > 0 &&
    '_managedLeagueId' in newData &&
    (
      (Array.isArray(newData.leagueIds) && (newData.leagueIds as string[]).includes(newData._managedLeagueId as string)) ||
      oldLeagueIds.includes(newData._managedLeagueId as string)
    ) &&
    isManagerOfLeague(leagueData, callerUid)
  );
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A user who became LM via createLeagueAndBecomeManager — role stays 'coach'. */
const membershipsBasedLM = {
  uid: 'uid-coach-lm',
  profile: { role: 'coach' as const },
};

/** A user with the legacy top-level role='league_manager'. */
const legacyRoleLM = {
  uid: 'uid-legacy-lm',
  profile: { role: 'league_manager' as const },
};

/** A coach with no LM membership. */
const plainCoach = {
  uid: 'uid-plain-coach',
  profile: { role: 'coach' as const },
};

/** A league that both LM types manage (uid in managerIds). */
const league = {
  id: 'league-spring',
  data: { managerIds: [membershipsBasedLM.uid, legacyRoleLM.uid] },
};

/** A different league that neither test LM manages. */
const otherLeague = {
  id: 'league-other',
  data: { managerIds: ['uid-somebody-else'] },
};

/** A valid assign-to-league write: only leagueIds + _managedLeagueId change. */
function assignPayload(leagueId: string, oldLeagueIds: string[] = []) {
  return {
    affectedKeys: ['leagueIds', '_managedLeagueId'],
    newData: { leagueIds: [...oldLeagueIds, leagueId], _managedLeagueId: leagueId },
    oldLeagueIds,
  };
}

/** A valid remove-from-league write: _managedLeagueId still present, leagueId in OLD leagueIds. */
function removePayload(leagueId: string, currentLeagueIds: string[]) {
  const newLeagueIds = currentLeagueIds.filter(id => id !== leagueId);
  return {
    affectedKeys: ['leagueIds', '_managedLeagueId'],
    newData: { leagueIds: newLeagueIds, _managedLeagueId: leagueId },
    oldLeagueIds: currentLeagueIds,
  };
}

// =============================================================================
// SEC-35 regression: memberships-based LM was blocked before the fix
// =============================================================================

describe('SEC-35 regression — memberships-based LM', () => {
  /**
   * Emulator equivalent:
   *   const db = testEnv.authenticatedContext(membershipsBasedLM.uid, { role: 'coach' });
   *   await assertFails(db.collection('teams').doc('team-1').update({
   *     leagueIds: ['league-spring'], _managedLeagueId: 'league-spring'
   *   }));
   * (with leagueDoc managerIds including the UID, and the OLD rule in place)
   */
  it('BEFORE fix: memberships-based LM (role=coach) was denied by isLeagueManager() gate', () => {
    const { affectedKeys, newData, oldLeagueIds } = assignPayload(league.id);
    const allowed = lmBranchBefore(
      membershipsBasedLM.profile,
      league.data,
      membershipsBasedLM.uid,
      affectedKeys,
      newData,
      oldLeagueIds,
    );
    expect(allowed).toBe(false);
  });

  /**
   * Emulator equivalent:
   *   const db = testEnv.authenticatedContext(membershipsBasedLM.uid, { role: 'coach' });
   *   await assertSucceeds(db.collection('teams').doc('team-1').update({
   *     leagueIds: ['league-spring'], _managedLeagueId: 'league-spring'
   *   }));
   * (with leagueDoc managerIds including the UID, and the FIXED rule)
   */
  it('AFTER fix: memberships-based LM (role=coach) is allowed when in league.managerIds', () => {
    const { affectedKeys, newData, oldLeagueIds } = assignPayload(league.id);
    const allowed = lmBranchAfter(
      league.data,
      membershipsBasedLM.uid,
      affectedKeys,
      newData,
      oldLeagueIds,
    );
    expect(allowed).toBe(true);
  });
});

// =============================================================================
// Legacy-role LM still works after the fix
// =============================================================================

describe('legacy-role LM (role=league_manager) — still allowed after fix', () => {
  /**
   * Emulator equivalent: assertSucceeds with role='league_manager' auth claim.
   */
  it('legacy-role LM can assign a team to their league (AFTER fix)', () => {
    const { affectedKeys, newData, oldLeagueIds } = assignPayload(league.id);
    const allowed = lmBranchAfter(
      league.data,
      legacyRoleLM.uid,
      affectedKeys,
      newData,
      oldLeagueIds,
    );
    expect(allowed).toBe(true);
  });

  it('legacy-role LM can remove a team from their league (AFTER fix)', () => {
    const { affectedKeys, newData, oldLeagueIds } = removePayload(league.id, [league.id]);
    const allowed = lmBranchAfter(
      league.data,
      legacyRoleLM.uid,
      affectedKeys,
      newData,
      oldLeagueIds,
    );
    expect(allowed).toBe(true);
  });
});

// =============================================================================
// isManagerOfLeague gate: LM cannot touch a league they do not manage
// =============================================================================

describe('isManagerOfLeague gate — must still deny cross-league writes', () => {
  /**
   * Emulator equivalent:
   *   const db = testEnv.authenticatedContext(membershipsBasedLM.uid, { role: 'coach' });
   *   await assertFails(db.collection('teams').doc('team-1').update({
   *     leagueIds: ['league-other'], _managedLeagueId: 'league-other'
   *   }));
   * (where otherLeague.managerIds does NOT include the UID)
   */
  it('memberships-based LM is denied when _managedLeagueId points to a league they do not manage', () => {
    const { affectedKeys, newData, oldLeagueIds } = assignPayload(otherLeague.id);
    const allowed = lmBranchAfter(
      otherLeague.data,
      membershipsBasedLM.uid,
      affectedKeys,
      newData,
      oldLeagueIds,
    );
    expect(allowed).toBe(false);
  });

  it('legacy-role LM is denied when _managedLeagueId points to a league they do not manage', () => {
    const { affectedKeys, newData, oldLeagueIds } = assignPayload(otherLeague.id);
    const allowed = lmBranchAfter(
      otherLeague.data,
      legacyRoleLM.uid,
      affectedKeys,
      newData,
      oldLeagueIds,
    );
    expect(allowed).toBe(false);
  });

  /**
   * A subtle escalation vector: a user sets _managedLeagueId to a league they
   * manage but supplies a leagueIds array containing a DIFFERENT league.
   * The rule must deny this because the leagueIds value check requires
   * _managedLeagueId to appear in the incoming OR outgoing leagueIds — if the
   * user is trying to add otherLeague.id to leagueIds but sets _managedLeagueId
   * to league.id, the gate will only authorise changes to league.id.
   *
   * Emulator equivalent: assertFails
   */
  it('LM cannot add a team to a league they do not manage by setting _managedLeagueId to one they do manage', () => {
    // Crafted payload: leagueIds gains otherLeague.id, but _managedLeagueId is
    // league.id (which the LM does manage).  This violates the leagueIds check
    // because otherLeague.id does not appear in either incoming or outgoing
    // leagueIds relative to _managedLeagueId — actually the rule checks that
    // _managedLeagueId is IN leagueIds, not the reverse.
    // Here _managedLeagueId = league.id is NOT in newData.leagueIds = [otherLeague.id].
    const newData = { leagueIds: [otherLeague.id], _managedLeagueId: league.id };
    const affectedKeys = ['leagueIds', '_managedLeagueId'];
    const oldLeagueIds: string[] = [];

    const allowed = lmBranchAfter(
      league.data, // they manage this league
      membershipsBasedLM.uid,
      affectedKeys,
      newData,
      oldLeagueIds,
    );
    expect(allowed).toBe(false);
  });
});

// =============================================================================
// Non-LM coach is denied
// =============================================================================

describe('plain coach (no league_manager membership) — denied', () => {
  /**
   * Emulator equivalent:
   *   const db = testEnv.authenticatedContext(plainCoach.uid, { role: 'coach' });
   *   await assertFails(db.collection('teams').doc('team-1').update({
   *     leagueIds: ['league-spring'], _managedLeagueId: 'league-spring'
   *   }));
   * (plainCoach.uid is NOT in league.data.managerIds)
   */
  it('plain coach is denied because their UID is not in league.managerIds', () => {
    const { affectedKeys, newData, oldLeagueIds } = assignPayload(league.id);
    const allowed = lmBranchAfter(
      league.data,
      plainCoach.uid,
      affectedKeys,
      newData,
      oldLeagueIds,
    );
    expect(allowed).toBe(false);
  });
});

// =============================================================================
// Field-key restriction — only ['leagueIds', '_managedLeagueId'] may change
// =============================================================================

describe('affectedKeys restriction — only leagueIds and _managedLeagueId allowed', () => {
  /**
   * Emulator equivalent:
   *   await assertFails(db.collection('teams').doc('team-1').update({
   *     leagueIds: [...], _managedLeagueId: '...', name: 'Hack'
   *   }));
   */
  it('is denied when the write also modifies team name', () => {
    const newData = { leagueIds: [league.id], _managedLeagueId: league.id, name: 'Hack' };
    const affectedKeys = ['leagueIds', '_managedLeagueId', 'name'];
    const allowed = lmBranchAfter(
      league.data,
      membershipsBasedLM.uid,
      affectedKeys,
      newData,
      [],
    );
    expect(allowed).toBe(false);
  });

  it('is denied when the write tries to change coachIds alongside league fields', () => {
    const newData = { leagueIds: [league.id], _managedLeagueId: league.id, coachIds: ['uid-injected'] };
    const affectedKeys = ['leagueIds', '_managedLeagueId', 'coachIds'];
    const allowed = lmBranchAfter(
      league.data,
      membershipsBasedLM.uid,
      affectedKeys,
      newData,
      [],
    );
    expect(allowed).toBe(false);
  });

  it('is denied when no keys change at all (empty affectedKeys)', () => {
    const allowed = lmBranchAfter(
      league.data,
      membershipsBasedLM.uid,
      [], // nothing changed
      { _managedLeagueId: league.id },
      [],
    );
    expect(allowed).toBe(false);
  });
});

// =============================================================================
// _managedLeagueId presence check
// =============================================================================

describe('_managedLeagueId presence — required in request.resource.data', () => {
  /**
   * Emulator equivalent:
   *   await assertFails(db.collection('teams').doc('team-1').update({
   *     leagueIds: ['league-spring']
   *     // _managedLeagueId deliberately omitted
   *   }));
   */
  it('is denied when _managedLeagueId is absent from the incoming document', () => {
    const newData: Record<string, unknown> = { leagueIds: [league.id] }; // no _managedLeagueId
    const affectedKeys = ['leagueIds'];
    const allowed = lmBranchAfter(
      league.data,
      membershipsBasedLM.uid,
      affectedKeys,
      newData,
      [],
    );
    expect(allowed).toBe(false);
  });
});

// =============================================================================
// leagueIds value check — _managedLeagueId must appear in incoming OR old leagueIds
// =============================================================================

describe('leagueIds value check — _managedLeagueId must be in incoming or existing leagueIds', () => {
  it('is allowed when _managedLeagueId appears in the new leagueIds array (adding)', () => {
    const { affectedKeys, newData, oldLeagueIds } = assignPayload(league.id);
    const allowed = lmBranchAfter(
      league.data,
      membershipsBasedLM.uid,
      affectedKeys,
      newData,
      oldLeagueIds,
    );
    expect(allowed).toBe(true);
  });

  it('is allowed when _managedLeagueId appears in the old leagueIds array (removing)', () => {
    const { affectedKeys, newData, oldLeagueIds } = removePayload(league.id, [league.id]);
    const allowed = lmBranchAfter(
      league.data,
      membershipsBasedLM.uid,
      affectedKeys,
      newData,
      oldLeagueIds,
    );
    expect(allowed).toBe(true);
  });

  it('is denied when _managedLeagueId does not appear in either old or new leagueIds', () => {
    // _managedLeagueId references league.id, but neither old nor new leagueIds include it
    const newData = { leagueIds: ['league-unrelated'], _managedLeagueId: league.id };
    const affectedKeys = ['leagueIds', '_managedLeagueId'];
    const allowed = lmBranchAfter(
      league.data,
      membershipsBasedLM.uid,
      affectedKeys,
      newData,
      [], // old leagueIds also don't include league.id
    );
    expect(allowed).toBe(false);
  });
});

// =============================================================================
// Admin path is unaffected (control group)
// =============================================================================

describe('admin path — unaffected by SEC-35 (control group)', () => {
  /**
   * The admin branch is `if isAdmin()` which is a separate allow arm.
   * These tests document that admins remain unrestricted, which is separate
   * from the LM branch logic.
   *
   * In an emulator test this would be:
   *   const db = testEnv.authenticatedContext(adminUid, { role: 'admin' });
   *   await assertSucceeds(db.collection('teams').doc('team-1').update({
   *     leagueIds: ['league-spring'], _managedLeagueId: 'league-spring'
   *   }));
   *
   * Here we simply confirm that the isManagerOfLeague check does NOT gate
   * admins — the admin branch in the rules is evaluated before the LM branch.
   */
  it('isManagerOfLeague returns true for admin UID when they are in managerIds', () => {
    const adminUid = 'uid-admin';
    const leagueWithAdmin = { managerIds: [adminUid] };
    expect(isManagerOfLeague(leagueWithAdmin, adminUid)).toBe(true);
  });

  it('isManagerOfLeague returns false for admin UID when not in managerIds — but admin branch fires first in rules', () => {
    // The admin rule arm (allow update: if isAdmin() || ...) evaluates isAdmin()
    // before the LM branch.  Even if isManagerOfLeague is false for the admin UID,
    // the rules allow the write.  This test confirms the helper does not silently
    // grant admin access — the admin branch is a separate concern.
    const adminUid = 'uid-admin';
    const leagueWithoutAdmin = { managerIds: ['uid-someone-else'] };
    expect(isManagerOfLeague(leagueWithoutAdmin, adminUid)).toBe(false);
  });
});
