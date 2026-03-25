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

export interface PlayerAbsence {
  type: 'injured' | 'suspended' | 'other';
  returnDate?: string;  // ISO date YYYY-MM-DD
  note?: string;        // private, only visible to coach/admin
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
  absence?: PlayerAbsence | null;
  parentContact?: ParentContact;
  parentContact2?: ParentContact;
  emergencyContact?: EmergencyContact;
  createdAt: string;
  updatedAt: string;
}
