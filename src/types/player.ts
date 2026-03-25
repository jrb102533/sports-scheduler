export type PlayerStatus = 'active' | 'injured' | 'suspended' | 'inactive';

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
  /** ISO date string — expected return date for injured/suspended players */
  statusReturnDate?: string;
  /**
   * Coach-only private note about the injury/suspension.
   * Must NOT be exposed to player or parent roles.
   */
  statusNote?: string;
  /** ISO timestamp of the last status change */
  statusUpdatedAt?: string;
  notes?: string;
  absence?: PlayerAbsence | null;
  parentContact?: ParentContact;
  parentContact2?: ParentContact;
  emergencyContact?: EmergencyContact;
  createdAt: string;
  updatedAt: string;
}
