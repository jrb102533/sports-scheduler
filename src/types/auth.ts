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
  /** When false, the user will not receive the Monday morning weekly digest notification. Defaults to true. */
  weeklyDigestEnabled?: boolean;
  /** When false, the user will not receive email notifications for team chat and direct messages. Defaults to true. */
  messagingNotificationsEnabled?: boolean;
  /** Subscription tier. Defaults to 'free'. League managers must upgrade to 'league_manager_pro' to access LM features. */
  subscriptionTier?: SubscriptionTier;
  /** Stripe subscription status mirrored from the customers/{uid}/subscriptions subcollection. */
  subscriptionStatus?: SubscriptionStatus;
  /** ISO timestamp when paid access ends — period end if canceled, trial end if trialing, etc. */
  subscriptionExpiresAt?: string;
  /** Billing interval of the active subscription. */
  subscriptionInterval?: 'month' | 'year';
  /** Price in the smallest currency unit (cents for USD). */
  subscriptionPriceAmount?: number;
  /** ISO 4217 currency code (e.g. 'usd'). */
  subscriptionCurrency?: string;
  /** Admin-granted Pro access bypass (support cases, comps). When true, treat as Pro regardless of Stripe state. */
  adminGrantedLM?: boolean;
  /** Reserved for future grandfather policy. Locked false at launch (no existing LM users at decision time). */
  grandfathered?: boolean;
}

export type SubscriptionTier = 'free' | 'league_manager_pro';

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid';
