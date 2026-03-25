export type PlayerStatus = 'active' | 'injured' | 'inactive';

export interface ParentContact {
  parentName: string;
  parentPhone: string;
  parentEmail?: string;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship?: string;
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
  parentContact2?: ParentContact;
  emergencyContact?: EmergencyContact;
  createdAt: string;
  updatedAt: string;
}
