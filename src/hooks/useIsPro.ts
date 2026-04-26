/**
 * useIsPro
 *
 * Returns true if the currently signed-in user has Pro entitlement.
 *
 * Entitlement rules (any one is sufficient):
 *   1. subscriptionTier === 'league_manager_pro'  (active / trialing / past_due Stripe states)
 *   2. adminGrantedLM === true                     (admin-comp bypass)
 *   3. subscriptionStatus === 'canceled' AND subscriptionExpiresAt > now
 *      (canceled but still within the paid period)
 *   4. profile.role === 'admin'                    (admins always see Pro actions)
 *
 * Reads only from useAuthStore — zero additional Firestore reads.
 */

import { useAuthStore } from '@/store/useAuthStore';

export function useIsPro(): boolean {
  const profile = useAuthStore(s => s.profile);

  if (!profile) return false;

  // Admins bypass the subscription gate entirely.
  // Inline check (no hasRole dependency) so this hook stays decoupled from
  // role-helper imports — keeps the test mock surface tiny.
  const legacyRole = profile.role;
  const membershipRoles = (profile.memberships ?? []).map(m => m.role);
  if (legacyRole === 'admin' || membershipRoles.includes('admin')) return true;

  const { subscriptionTier, subscriptionStatus, subscriptionExpiresAt, adminGrantedLM } = profile;

  // Admin-granted bypass (support comps, etc.)
  if (adminGrantedLM === true) return true;

  // Active Pro tier
  if (subscriptionTier === 'league_manager_pro') return true;

  // Canceled but still within paid access window
  if (
    subscriptionStatus === 'canceled' &&
    subscriptionExpiresAt != null &&
    new Date(subscriptionExpiresAt).getTime() > Date.now()
  ) {
    return true;
  }

  return false;
}
