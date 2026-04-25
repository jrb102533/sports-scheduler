/**
 * Firestore security rules — FW-62
 *
 * Self-update on /users/{uid} must NOT permit writes to subscription fields.
 * These are managed by the firestore-stripe-payments extension and the
 * subscription-sync Cloud Function (FW-63). A user being able to self-grant
 * Pro access by writing `subscriptionTier = 'league_manager_pro'` would
 * defeat the entire paywall.
 *
 * Tests the rule LOGIC in isolation — see other firestore.rules.*.test.ts
 * files for the rationale on emulator-free rule testing.
 */

import { describe, it, expect } from 'vitest';

const SUBSCRIPTION_FIELDS = [
  'subscriptionTier',
  'subscriptionStatus',
  'subscriptionExpiresAt',
  'adminGrantedLM',
  'grandfathered',
] as const;

const FORBIDDEN_SELF_UPDATE_KEYS = [
  'uid',
  'memberships',
  ...SUBSCRIPTION_FIELDS,
];

/**
 * Mirrors the self-update branch of the /users/{uid} update rule:
 *   request.auth.uid == uid
 *     && !request.resource.data.diff(resource.data).affectedKeys()
 *         .hasAny(['uid', 'memberships', 'subscriptionTier', ...])
 */
function selfUpdateAllowed(authUid: string, docUid: string, affectedKeys: string[]): boolean {
  if (authUid !== docUid) return false;
  return !affectedKeys.some(k => FORBIDDEN_SELF_UPDATE_KEYS.includes(k as typeof FORBIDDEN_SELF_UPDATE_KEYS[number]));
}

describe('FW-62 — subscription field self-update restrictions', () => {
  it('blocks self-update touching subscriptionTier', () => {
    expect(selfUpdateAllowed('user-1', 'user-1', ['subscriptionTier'])).toBe(false);
  });

  it('blocks self-update touching subscriptionStatus', () => {
    expect(selfUpdateAllowed('user-1', 'user-1', ['subscriptionStatus'])).toBe(false);
  });

  it('blocks self-update touching subscriptionExpiresAt', () => {
    expect(selfUpdateAllowed('user-1', 'user-1', ['subscriptionExpiresAt'])).toBe(false);
  });

  it('blocks self-update touching adminGrantedLM (anti-self-grant)', () => {
    expect(selfUpdateAllowed('user-1', 'user-1', ['adminGrantedLM'])).toBe(false);
  });

  it('blocks self-update touching grandfathered', () => {
    expect(selfUpdateAllowed('user-1', 'user-1', ['grandfathered'])).toBe(false);
  });

  it('blocks self-update mixing allowed + subscription fields', () => {
    expect(selfUpdateAllowed('user-1', 'user-1', ['displayName', 'subscriptionTier'])).toBe(false);
  });

  it('still allows self-update of normal profile fields', () => {
    expect(selfUpdateAllowed('user-1', 'user-1', ['displayName'])).toBe(true);
    expect(selfUpdateAllowed('user-1', 'user-1', ['avatarUrl'])).toBe(true);
    expect(selfUpdateAllowed('user-1', 'user-1', ['weeklyDigestEnabled'])).toBe(true);
  });

  it('still blocks the legacy forbidden fields (uid, memberships)', () => {
    expect(selfUpdateAllowed('user-1', 'user-1', ['uid'])).toBe(false);
    expect(selfUpdateAllowed('user-1', 'user-1', ['memberships'])).toBe(false);
  });

  it('blocks any self-update when authUid != docUid', () => {
    expect(selfUpdateAllowed('user-1', 'user-2', ['displayName'])).toBe(false);
  });
});
