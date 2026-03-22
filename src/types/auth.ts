export type UserRole = 'admin' | 'coach' | 'player' | 'parent';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  teamId?: string;      // coaches: team they manage; players/parents: team they belong to
  playerId?: string;    // parents: the player (their child) they follow
  avatarUrl?: string;
  createdAt: string;
}
