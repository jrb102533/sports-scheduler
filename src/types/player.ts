export type PlayerStatus = 'active' | 'injured' | 'inactive';

export interface Player {
  id: string;
  teamId: string;
  firstName: string;
  lastName: string;
  jerseyNumber?: number;
  position?: string;
  dateOfBirth?: string;
  email?: string;
  phone?: string;
  status: PlayerStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
