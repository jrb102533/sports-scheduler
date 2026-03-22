export type UserRole = 'admin' | 'league_manager' | 'coach' | 'player' | 'parent';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  teamId?: string;      // coaches: team they manage; players/parents: team they belong to
  playerId?: string;    // parents: the player (their child) they follow
  leagueId?: string;   // league_managers: the league they administer
  avatarUrl?: string;
  createdAt: string;
}
