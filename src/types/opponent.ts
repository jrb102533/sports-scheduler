export interface Opponent {
  id: string;
  name: string;
  teamId: string; // the team that this opponent plays against
  location?: string;
  createdAt: string;
}
