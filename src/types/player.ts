export type PlayerStatus = 'active' | 'injured' | 'inactive';

export interface ParentContact {
  parentName: string;
  parentPhone: string;
}

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
  parentContact?: ParentContact;
  createdAt: string;
  updatedAt: string;
}
