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

/**
 * Coach/admin-only PII stored in players/{id}/sensitiveData/private subcollection.
 * The Firestore rule for this path restricts reads to isAdmin() || isCoach().
 * These fields are merged into Player objects in usePlayerStore for privileged
 * users, so all existing component code continues to work unchanged.
 */
export interface SensitivePlayerData {
  /** Mirrors the parent document ID for collection-group queries. */
  playerId: string;
  teamId: string;
  dateOfBirth?: string;
  parentContact?: ParentContact;
  parentContact2?: ParentContact;
  emergencyContact?: EmergencyContact;
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
  /**
   * Firebase Auth UID of the user account linked to this player record.
   * Set when a player self-registers or a coach links an existing user.
   * Used for Firestore security rules (player self-service writes) and
   * availability ownership checks.
   */
  linkedUid?: string;
  notes?: string;
  absence?: PlayerAbsence | null;
  parentContact?: ParentContact;
  parentContact2?: ParentContact;
  emergencyContact?: EmergencyContact;
  createdAt: string;
  updatedAt: string;
}
