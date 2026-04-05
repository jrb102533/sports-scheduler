import type { RoleMembership, UserProfile, UserRole } from '@/types';

/**
 * Derives the top-level legacy scalar fields from the primary membership.
 * Always call this after mutating memberships[] to keep the profile in sync.
 */
export function syncLegacyScalars(memberships: RoleMembership[]): Pick<UserProfile, 'role' | 'teamId' | 'leagueId'> {
  const primary = memberships.find(m => m.isPrimary) ?? memberships[0];
  if (!primary) return { role: 'player' };
  return {
    role: primary.role,
    ...(primary.teamId ? { teamId: primary.teamId } : { teamId: undefined }),
    ...(primary.leagueId ? { leagueId: primary.leagueId } : { leagueId: undefined }),
  };
}

/**
 * Adds a new membership. If this is the first membership it is marked primary.
 * Does not mutate the input array.
 */
export function addMembership(
  current: RoleMembership[],
  membership: Omit<RoleMembership, 'isPrimary'>,
): RoleMembership[] {
  const isPrimary = current.length === 0;
  return [...current, { ...membership, isPrimary }];
}

/**
 * Removes a membership by index. If the removed membership was primary,
 * promotes the first remaining membership to primary.
 * Returns null if removing would leave the user with no memberships.
 */
export function removeMembership(
  current: RoleMembership[],
  index: number,
): RoleMembership[] | null {
  if (current.length <= 1) return null; // block — must keep at least one
  const wasPrimary = current[index]?.isPrimary ?? false;
  const next = current.filter((_, i) => i !== index);
  if (wasPrimary) {
    next[0] = { ...next[0], isPrimary: true };
  }
  return next;
}

/**
 * Promotes a membership at the given index to primary,
 * demoting all others. Does not mutate the input array.
 */
export function setPrimaryMembership(
  current: RoleMembership[],
  index: number,
): RoleMembership[] {
  return current.map((m, i) => ({ ...m, isPrimary: i === index }));
}

/**
 * Returns the abbreviated role label used in pills.
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  coach: 'Coach',
  league_manager: 'LM',
  player: 'Player',
  parent: 'Parent',
};

export const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-purple-100 text-purple-700',
  league_manager: 'bg-indigo-100 text-indigo-700',
  coach: 'bg-blue-100 text-blue-700',
  player: 'bg-green-100 text-green-700',
  parent: 'bg-orange-100 text-orange-700',
};

export const ROLE_AVATAR_COLORS: Record<UserRole, string> = {
  admin: 'bg-purple-600',
  league_manager: 'bg-indigo-600',
  coach: 'bg-blue-600',
  player: 'bg-green-600',
  parent: 'bg-orange-500',
};
