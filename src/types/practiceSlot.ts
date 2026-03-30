/**
 * Status of a PracticeSlotWindow.
 * - 'active'   — coaches can see and sign up
 * - 'paused'   — visible but signup disabled
 * - 'archived' — hidden from coach view; kept for historical reference
 */
export type SlotWindowStatus = 'active' | 'paused' | 'archived';

/**
 * Status of an individual signup within a slot occurrence.
 * - 'confirmed'  — team has a confirmed booking; a ScheduledEvent exists
 * - 'waitlisted' — capacity full; team is queued
 * - 'cancelled'  — coach cancelled; kept for audit trail
 */
export type SignupStatus = 'confirmed' | 'waitlisted' | 'cancelled';

/**
 * A recurring (or one-off) practice slot window created by a League Manager.
 *
 * Stored at: leagues/{leagueId}/seasons/{seasonId}/practiceSlotWindows/{windowId}
 *
 * Represents a template like "Tuesdays 6–8pm on Field A, capacity 2 teams"
 * that generates virtual occurrences weekly between effectiveStart and effectiveEnd.
 * Occurrences are computed client-side — not stored as documents.
 */
export interface PracticeSlotWindow {
  id: string;

  /** Display label, e.g. "Tuesday Evening — Field A" */
  name: string;

  venueId: string;
  /** Denormalized for display without extra reads */
  venueName: string;

  /** Specific field within the venue (VenueField.id). Null = whole venue. */
  fieldId: string | null;
  /** Denormalized field name */
  fieldName: string | null;

  /** Day of week: 0=Sun … 6=Sat. Null for one-off slots. */
  dayOfWeek: number | null;

  /** Time range in "HH:MM" 24-hour format */
  startTime: string;
  endTime: string;

  /** Date range during which this window recurs (ISO date strings "YYYY-MM-DD") */
  effectiveStart: string;
  effectiveEnd: string;

  /**
   * For one-off slots: a single ISO date string.
   * When set, dayOfWeek is ignored and this window produces exactly one occurrence.
   */
  oneOffDate: string | null;

  /** Maximum number of teams that can practice simultaneously in this slot */
  capacity: number;

  /** ISO date strings where this slot is blacked out (e.g. holidays) */
  blackoutDates: string[];

  status: SlotWindowStatus;

  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A coach's signup for a specific occurrence of a PracticeSlotWindow.
 *
 * Stored at: leagues/{leagueId}/seasons/{seasonId}/practiceSlotSignups/{signupId}
 *
 * Document ID is deterministic: `{windowId}_{occurrenceDate}_{teamId}`
 * This prevents double-booking the same team on the same occurrence.
 *
 * Written exclusively by Cloud Functions (Admin SDK) to enforce FCFS atomicity.
 * Direct client writes are blocked in security rules.
 */
export interface PracticeSlotSignup {
  id: string;

  windowId: string;

  /** The specific date of this occurrence (ISO date, e.g. "2026-04-07") */
  occurrenceDate: string;

  teamId: string;
  /** Denormalized for display */
  teamName: string;

  coachUid: string;
  coachName: string;

  status: SignupStatus;

  /**
   * Position in the waitlist (1-based). Only meaningful when status = 'waitlisted'.
   * Null when confirmed or cancelled.
   */
  waitlistPosition: number | null;

  /**
   * Reference to the ScheduledEvent created when status = 'confirmed'.
   * Null when waitlisted or cancelled.
   */
  eventId: string | null;

  /** Timestamp of the signup action — used for FCFS ordering */
  signedUpAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}
