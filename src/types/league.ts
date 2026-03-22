import type { SportType } from './team';

export interface League {
  id: string;
  name: string;
  season?: string;
  description?: string;
  sportType?: SportType;
  managedBy?: string; // uid of the league_manager user
  createdAt: string;
  updatedAt: string;
}
