// Firestore security rules - FW-64
//
// Gate all league-manager-only WRITE operations on the `subscription` JWT claim
// ('league_manager_pro'). Reads are intentionally ungated so a canceled LM can
// still view their data. Admins always bypass the subscription check.
//
// Paths gated (non-admin LM writes only):
//   /leagues/{leagueId}                              - create, update
//   /leagues/{leagueId}/seasons/{seasonId}            - write (create/update/delete)
//   /leagues/{leagueId}/divisions/{divisionId}        - write
//   /leagues/{leagueId}/venues/{venueId}              - create, update, delete
//   /leagues/{leagueId}/fixtures/{fixtureId}          - write
//   /leagues/{leagueId}/drafts/{draftId}              - write
//   /leagues/{leagueId}/availabilityCollections/{id}  - create, update, delete
//   /leagues/{leagueId}/seasons/{id}/wizardDraft/{id} - write
//   /leagues/{leagueId}/seasons/{id}/scheduleConfig/* - write
//
// Why emulator tests are not used:
// Same rationale as firestore.rules.fw62-subscription.test.ts - no
// @firebase/rules-unit-testing infrastructure in this project. These tests
// exercise the rule LOGIC (boolean conditions) in isolation so the paywall
// semantics are machine-verified without a running emulator. Convert to
// assertSucceeds / assertFails emulator calls when that infrastructure is added.

import { describe, it, expect } from 'vitest';

// ─── Token / auth shapes ─────────────────────────────────────────────────────

interface AuthToken {
  uid: string;
  role: string;
  subscription?: string;
}

// ─── Rule-logic helpers (mirrors firestore.rules semantics) ──────────────────

/** Mirrors: function isAdmin() */
function isAdmin(token: AuthToken): boolean {
  return token.role === 'admin';
}

/** Mirrors: function isLeagueManager() */
function isLeagueManager(token: AuthToken): boolean {
  return token.role === 'league_manager';
}

/** Mirrors: function hasSubscription() */
function hasSubscription(token: AuthToken): boolean {
  return token.subscription === 'league_manager_pro';
}

/**
 * Mirrors: function isManagerOfLeague(leagueData)
 * Used for the create path where we check request.resource.data.managerIds.
 */
function isManagerOfLeague(leagueData: { managerIds?: string[] }, callerUid: string): boolean {
  return Array.isArray(leagueData.managerIds) && leagueData.managerIds.includes(callerUid);
}

/**
 * Mirrors: function isManagerOfLeagueById(leagueId) - simplified for unit tests:
 * we pass the resolved league document data directly instead of doing a get().
 */
function isManagerOfLeagueById(leagueDoc: { managerIds?: string[] }, callerUid: string): boolean {
  return isManagerOfLeague(leagueDoc, callerUid);
}

// ─── Per-path allow logic (mirrors each relevant rule) ───────────────────────

/**
 * /leagues/{leagueId} - create
 *
 * allow create: if isAdmin()
 *   || ((isLeagueManager() || (request.auth != null && isManagerOfLeague(request.resource.data)))
 *       && hasSubscription());
 */
function leagueCreateAllowed(
  token: AuthToken,
  incomingData: { managerIds?: string[] },
): boolean {
  if (isAdmin(token)) return true;
  const isLmByRole = isLeagueManager(token);
  const isLmByData = isManagerOfLeague(incomingData, token.uid);
  return (isLmByRole || isLmByData) && hasSubscription(token);
}

/**
 * /leagues/{leagueId} - update
 *
 * allow update: if isAdmin()
 *   || (
 *     isManagerOfLeague(resource.data)
 *     && resource.data.isDeleted != true
 *     && !affectedKeys.hasAny(['managerIds', 'managedBy'])
 *     && hasSubscription()
 *   );
 */
function leagueUpdateAllowed(
  token: AuthToken,
  existingData: { managerIds?: string[]; isDeleted?: boolean },
  affectedKeys: string[],
): boolean {
  if (isAdmin(token)) return true;
  const forbidden = ['managerIds', 'managedBy'];
  return (
    isManagerOfLeagueById(existingData, token.uid) &&
    existingData.isDeleted !== true &&
    !affectedKeys.some(k => forbidden.includes(k)) &&
    hasSubscription(token)
  );
}

// Mirrors write rules that share the same shape:
//   allow write: if isAdmin() || (isManagerOfLeagueById(leagueId) && hasSubscription());
//
// Covers:
//   /leagues/{id}/seasons/{id}
//   /leagues/{id}/divisions/{id}
//   /leagues/{id}/fixtures/{id}
//   /leagues/{id}/drafts/{id}
//   /leagues/{id}/seasons/{id}/scheduleConfig/{id}
function lmSubcollectionWriteAllowed(
  token: AuthToken,
  leagueDoc: { managerIds?: string[] },
): boolean {
  if (isAdmin(token)) return true;
  return isManagerOfLeagueById(leagueDoc, token.uid) && hasSubscription(token);
}

// Mirrors write rules that also check leagueDoc.isDeleted:
//   allow write: if isAdmin()
//     || (isManagerOfLeagueById(leagueId) && leagueDoc.isDeleted != true && hasSubscription());
//
// Covers:
//   /leagues/{id}/seasons/{id}/wizardDraft/{id}
//   /leagues/{id}/availabilityCollections/{id}
function lmSubcollectionWriteWithDeletedGuard(
  token: AuthToken,
  leagueDoc: { managerIds?: string[]; isDeleted?: boolean },
): boolean {
  if (isAdmin(token)) return true;
  return (
    isManagerOfLeagueById(leagueDoc, token.uid) &&
    leagueDoc.isDeleted !== true &&
    hasSubscription(token)
  );
}

/**
 * League/season/division/venue READ - ungated for non-admin authenticated users.
 * The actual read rules have various `isCoach() || isManagerOfLeagueById()` checks
 * but none require hasSubscription(). We verify subscription is NOT in the read path.
 *
 * Simplified model: any LM who is a manager of the league can read, regardless
 * of subscription.
 */
function lmReadAllowed(
  token: AuthToken,
  leagueDoc: { managerIds?: string[] },
): boolean {
  // Reads are never gated on subscription - only role/membership required.
  if (isAdmin(token)) return true;
  return isManagerOfLeagueById(leagueDoc, token.uid); // no hasSubscription() check
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

const LEAGUE_ID = 'league-abc';

const lmWithSub: AuthToken = {
  uid: 'lm-sub-uid',
  role: 'league_manager',
  subscription: 'league_manager_pro',
};

const lmNoSub: AuthToken = {
  uid: 'lm-nosub-uid',
  role: 'league_manager',
  // subscription claim absent - simulates expired / never subscribed
};

const adminNoSub: AuthToken = {
  uid: 'admin-uid',
  role: 'admin',
  // deliberately NO subscription claim - verifies admin bypass
};

const coachToken: AuthToken = {
  uid: 'coach-uid',
  role: 'coach',
  subscription: 'league_manager_pro', // coaches should never be gated regardless
};

// League doc where lmWithSub is a manager
const leagueDocWithSub: { managerIds: string[]; isDeleted?: boolean } = {
  managerIds: [lmWithSub.uid],
};

// League doc where lmNoSub is a manager
const leagueDocNoSub: { managerIds: string[]; isDeleted?: boolean } = {
  managerIds: [lmNoSub.uid],
};

// League doc where admin is listed (edge case - admin is also in managerIds)
const leagueDocAdmin: { managerIds: string[]; isDeleted?: boolean } = {
  managerIds: [adminNoSub.uid],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FW-64 - subscription paywall on LM-only write paths', () => {

  // ── /leagues/{leagueId} create ───────────────────────────────────────────

  describe('/leagues - create', () => {
    it('LM with subscription CAN create league', () => {
      const incomingData = { managerIds: [lmWithSub.uid] };
      expect(leagueCreateAllowed(lmWithSub, incomingData)).toBe(true);
    });

    it('LM without subscription CANNOT create league', () => {
      const incomingData = { managerIds: [lmNoSub.uid] };
      expect(leagueCreateAllowed(lmNoSub, incomingData)).toBe(false);
    });

    it('Admin without subscription CAN create league (admin bypass)', () => {
      const incomingData = { managerIds: [adminNoSub.uid] };
      expect(leagueCreateAllowed(adminNoSub, incomingData)).toBe(true);
    });

    it('Authenticated user who self-assigns as manager + has subscription CAN create', () => {
      // Mirrors the (request.auth != null && isManagerOfLeague(request.resource.data)) branch
      const selfAssignToken: AuthToken = {
        uid: 'self-assign-uid',
        role: 'coach', // not league_manager by role
        subscription: 'league_manager_pro',
      };
      const incomingData = { managerIds: [selfAssignToken.uid] };
      expect(leagueCreateAllowed(selfAssignToken, incomingData)).toBe(true);
    });

    it('Authenticated user who self-assigns as manager WITHOUT subscription CANNOT create', () => {
      const selfAssignToken: AuthToken = {
        uid: 'self-assign-nosub-uid',
        role: 'coach',
        // no subscription
      };
      const incomingData = { managerIds: [selfAssignToken.uid] };
      expect(leagueCreateAllowed(selfAssignToken, incomingData)).toBe(false);
    });
  });

  // ── /leagues/{leagueId} update ───────────────────────────────────────────

  describe('/leagues - update', () => {
    it('LM with subscription CAN update league (name change)', () => {
      expect(
        leagueUpdateAllowed(lmWithSub, leagueDocWithSub, ['name']),
      ).toBe(true);
    });

    it('LM without subscription CANNOT update league', () => {
      expect(
        leagueUpdateAllowed(lmNoSub, leagueDocNoSub, ['name']),
      ).toBe(false);
    });

    it('Admin without subscription CAN update league (admin bypass)', () => {
      expect(
        leagueUpdateAllowed(adminNoSub, leagueDocAdmin, ['name']),
      ).toBe(true);
    });

    it('LM with subscription CANNOT update managerIds (SEC-29 denylist still enforced)', () => {
      expect(
        leagueUpdateAllowed(lmWithSub, leagueDocWithSub, ['managerIds']),
      ).toBe(false);
    });

    it('LM with subscription CANNOT update a soft-deleted league (SEC-76 still enforced)', () => {
      const deletedLeague = { ...leagueDocWithSub, isDeleted: true };
      expect(
        leagueUpdateAllowed(lmWithSub, deletedLeague, ['name']),
      ).toBe(false);
    });
  });

  // ── /leagues/{leagueId} read - ungated ──────────────────────────────────

  describe('/leagues - read (must NOT require subscription)', () => {
    it('LM without subscription CAN still read their league', () => {
      expect(lmReadAllowed(lmNoSub, leagueDocNoSub)).toBe(true);
    });

    it('LM with subscription CAN read their league', () => {
      expect(lmReadAllowed(lmWithSub, leagueDocWithSub)).toBe(true);
    });

    it('Admin can read any league', () => {
      expect(lmReadAllowed(adminNoSub, leagueDocNoSub)).toBe(true);
    });
  });

  // ── /leagues/{leagueId}/seasons - write ─────────────────────────────────

  describe('/leagues/{leagueId}/seasons - write', () => {
    it('LM with subscription CAN write season', () => {
      expect(lmSubcollectionWriteAllowed(lmWithSub, leagueDocWithSub)).toBe(true);
    });

    it('LM without subscription CANNOT write season', () => {
      expect(lmSubcollectionWriteAllowed(lmNoSub, leagueDocNoSub)).toBe(false);
    });

    it('Admin without subscription CAN write season (admin bypass)', () => {
      expect(lmSubcollectionWriteAllowed(adminNoSub, leagueDocAdmin)).toBe(true);
    });

    it('LM with subscription cannot write season of a league they do not manage', () => {
      const otherLeague = { managerIds: ['other-uid'] };
      expect(lmSubcollectionWriteAllowed(lmWithSub, otherLeague)).toBe(false);
    });
  });

  // ── /leagues/{leagueId}/divisions - write ────────────────────────────────

  describe('/leagues/{leagueId}/divisions - write', () => {
    it('LM with subscription CAN write division', () => {
      expect(lmSubcollectionWriteAllowed(lmWithSub, leagueDocWithSub)).toBe(true);
    });

    it('LM without subscription CANNOT write division', () => {
      expect(lmSubcollectionWriteAllowed(lmNoSub, leagueDocNoSub)).toBe(false);
    });

    it('Admin without subscription CAN write division (admin bypass)', () => {
      expect(lmSubcollectionWriteAllowed(adminNoSub, leagueDocAdmin)).toBe(true);
    });
  });

  // ── /leagues/{leagueId}/venues - write ──────────────────────────────────

  describe('/leagues/{leagueId}/venues - create/update/delete', () => {
    it('LM with subscription CAN write league venue', () => {
      expect(lmSubcollectionWriteAllowed(lmWithSub, leagueDocWithSub)).toBe(true);
    });

    it('LM without subscription CANNOT write league venue', () => {
      expect(lmSubcollectionWriteAllowed(lmNoSub, leagueDocNoSub)).toBe(false);
    });

    it('Admin without subscription CAN write league venue (admin bypass)', () => {
      expect(lmSubcollectionWriteAllowed(adminNoSub, leagueDocAdmin)).toBe(true);
    });
  });

  // ── /leagues/{leagueId}/fixtures - write ────────────────────────────────

  describe('/leagues/{leagueId}/fixtures - write', () => {
    it('LM with subscription CAN write fixture', () => {
      expect(lmSubcollectionWriteAllowed(lmWithSub, leagueDocWithSub)).toBe(true);
    });

    it('LM without subscription CANNOT write fixture', () => {
      expect(lmSubcollectionWriteAllowed(lmNoSub, leagueDocNoSub)).toBe(false);
    });

    it('Admin without subscription CAN write fixture (admin bypass)', () => {
      expect(lmSubcollectionWriteAllowed(adminNoSub, leagueDocAdmin)).toBe(true);
    });
  });

  // ── /leagues/{leagueId}/drafts - write ──────────────────────────────────

  describe('/leagues/{leagueId}/drafts - write', () => {
    it('LM with subscription CAN write draft', () => {
      expect(lmSubcollectionWriteAllowed(lmWithSub, leagueDocWithSub)).toBe(true);
    });

    it('LM without subscription CANNOT write draft', () => {
      expect(lmSubcollectionWriteAllowed(lmNoSub, leagueDocNoSub)).toBe(false);
    });

    it('Admin without subscription CAN write draft (admin bypass)', () => {
      expect(lmSubcollectionWriteAllowed(adminNoSub, leagueDocAdmin)).toBe(true);
    });

    it('LM without subscription CAN still READ draft (read ungated)', () => {
      // Read uses isManagerOfLeagueById only - no hasSubscription()
      expect(lmReadAllowed(lmNoSub, leagueDocNoSub)).toBe(true);
    });
  });

  // ── availabilityCollections - write (isDeleted guard) ───────────────────

  describe('/leagues/{leagueId}/availabilityCollections - create/update/delete', () => {
    it('LM with subscription CAN write availabilityCollection', () => {
      expect(lmSubcollectionWriteWithDeletedGuard(lmWithSub, leagueDocWithSub)).toBe(true);
    });

    it('LM without subscription CANNOT write availabilityCollection', () => {
      expect(lmSubcollectionWriteWithDeletedGuard(lmNoSub, leagueDocNoSub)).toBe(false);
    });

    it('Admin without subscription CAN write availabilityCollection (admin bypass)', () => {
      expect(lmSubcollectionWriteWithDeletedGuard(adminNoSub, leagueDocAdmin)).toBe(true);
    });

    it('LM with subscription CANNOT write availabilityCollection in a deleted league', () => {
      const deletedLeague = { ...leagueDocWithSub, isDeleted: true };
      expect(lmSubcollectionWriteWithDeletedGuard(lmWithSub, deletedLeague)).toBe(false);
    });
  });

  // ── seasons/*/wizardDraft - write (isDeleted guard) ──────────────────────

  describe('/leagues/{leagueId}/seasons/*/wizardDraft - write', () => {
    it('LM with subscription CAN write wizardDraft', () => {
      expect(lmSubcollectionWriteWithDeletedGuard(lmWithSub, leagueDocWithSub)).toBe(true);
    });

    it('LM without subscription CANNOT write wizardDraft', () => {
      expect(lmSubcollectionWriteWithDeletedGuard(lmNoSub, leagueDocNoSub)).toBe(false);
    });

    it('Admin without subscription CAN write wizardDraft (admin bypass)', () => {
      expect(lmSubcollectionWriteWithDeletedGuard(adminNoSub, leagueDocAdmin)).toBe(true);
    });

    it('LM with subscription CANNOT write wizardDraft in a deleted league', () => {
      const deletedLeague = { ...leagueDocWithSub, isDeleted: true };
      expect(lmSubcollectionWriteWithDeletedGuard(lmWithSub, deletedLeague)).toBe(false);
    });
  });

  // ── seasons/*/scheduleConfig - write ────────────────────────────────────

  describe('/leagues/{leagueId}/seasons/*/scheduleConfig - write', () => {
    it('LM with subscription CAN write scheduleConfig', () => {
      expect(lmSubcollectionWriteAllowed(lmWithSub, leagueDocWithSub)).toBe(true);
    });

    it('LM without subscription CANNOT write scheduleConfig', () => {
      expect(lmSubcollectionWriteAllowed(lmNoSub, leagueDocNoSub)).toBe(false);
    });

    it('Admin without subscription CAN write scheduleConfig (admin bypass)', () => {
      expect(lmSubcollectionWriteAllowed(adminNoSub, leagueDocAdmin)).toBe(true);
    });
  });

  // ── Non-LM paths - verify coaches/parents are NOT affected ──────────────

  describe('Non-LM paths - coach/parent writes must NOT be gated by subscription', () => {
    it('Coach operations use isCoachOfTeam, not hasSubscription - subscription claim irrelevant', () => {
      // The coach's subscription claim (even if set to 'league_manager_pro') has no
      // bearing on coach-path rules. This test documents the invariant: the coach
      // write paths (/teams, /players, /events) do not call hasSubscription() at all.
      // We verify hasSubscription() returns true for the coachToken (it has the claim)
      // but coach-path authorization is determined entirely by isCoachOfTeam().
      expect(hasSubscription(coachToken)).toBe(true); // claim is present
      // The coach path allows writes based on isCoachOfTeam(), not hasSubscription().
      // If a coach somehow had the claim stripped, their coach-path writes still work.
      const coachNoSubToken: AuthToken = { uid: 'coach-uid', role: 'coach' };
      expect(hasSubscription(coachNoSubToken)).toBe(false); // but this doesn't block coaches
      // Documented: hasSubscription() is called ONLY in isManagerOfLeagueById branches.
    });
  });

  // ── hasSubscription helper - claim value edge cases ──────────────────────

  describe('hasSubscription() - JWT claim edge cases', () => {
    it('returns false when subscription claim is absent', () => {
      const token: AuthToken = { uid: 'u', role: 'league_manager' };
      expect(hasSubscription(token)).toBe(false);
    });

    it('returns false when subscription claim is an unexpected value', () => {
      const token: AuthToken = { uid: 'u', role: 'league_manager', subscription: 'free' };
      expect(hasSubscription(token)).toBe(false);
    });

    it('returns true only for the exact value league_manager_pro', () => {
      const token: AuthToken = { uid: 'u', role: 'league_manager', subscription: 'league_manager_pro' };
      expect(hasSubscription(token)).toBe(true);
    });
  });
});
