/**
 * Shared type definitions used within Cloud Functions.
 * These mirror the frontend types in src/types/ — keep in sync when modifying.
 */

export type SlotWindowStatus = 'active' | 'paused' | 'archived';
export type SignupStatus = 'confirmed' | 'waitlisted' | 'cancelled';

export interface PracticeSlotWindow {
  id: string;
  name: string;
  venueId: string;
  venueName: string;
  fieldId: string | null;
  fieldName: string | null;
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
  effectiveStart: string;
  effectiveEnd: string;
  oneOffDate: string | null;
  capacity: number;
  blackoutDates: string[];
  status: SlotWindowStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PracticeSlotSignup {
  id: string;
  windowId: string;
  occurrenceDate: string;
  teamId: string;
  teamName: string;
  coachUid: string;
  coachName: string;
  status: SignupStatus;
  waitlistPosition: number | null;
  eventId: string | null;
  signedUpAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}
