export type UserRole = 'admin' | 'league_manager' | 'coach' | 'player' | 'parent';

/**
 * A single role+context pair. A user may hold multiple memberships
 * (e.g. coach on one team AND parent of a child on another team).
 */
export interface RoleMembership {
  role: UserRole;
  teamId?: string;     // coach / player / parent context
  playerId?: string;   // parent context: the child being followed
  leagueId?: string;   // league_manager context
  isPrimary?: boolean; // drives default dashboard/calendar view
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  /** Legacy single-role field — kept for backwards compatibility.
   *  Derived from the primary membership. Always populated. */
  role: UserRole;
  /** Legacy single-context fields — kept for backwards compatibility. */
  teamId?: string;
  playerId?: string;
  leagueId?: string;
  avatarUrl?: string;
  createdAt: string;
  /** Multi-role memberships. Present on all new accounts and migrated accounts.
   *  Falls back to deriving from role/teamId/playerId/leagueId if absent. */
  memberships?: RoleMembership[];
  /** Index into memberships[] for the currently active context. Defaults to 0. */
  activeContext?: number;
  /** Set to true by admin-created accounts. Forces a password change on first login. */
  mustChangePassword?: boolean;
}
