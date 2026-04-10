/**
 * Calendar-feed helper functions extracted from index.ts for unit testing.
 *
 * Source of truth remains index.ts for the functions that depend on the
 * ICAL_SECRET Firebase secret (signCalendarToken, verifyCalendarToken).
 * Keep these implementations in sync with index.ts when modifying.
 *
 * formatICalDate and icalEscape are pure utility functions with no secret
 * dependency and are safe to import directly.
 */

import * as crypto from 'crypto';
import { defineSecret } from 'firebase-functions/params';

export const icalSecret = defineSecret('ICAL_SECRET');

/** Sign a calendar feed token tied to a specific uid. */
export function signCalendarToken(uid: string): string {
  return crypto.createHmac('sha256', icalSecret.value()).update(uid).digest('hex');
}

/** Verify a calendar feed token. Uses timing-safe comparison. */
export function verifyCalendarToken(uid: string, token: string): boolean {
  try {
    const expected = Buffer.from(signCalendarToken(uid), 'hex');
    const provided = Buffer.from(token, 'hex');
    if (expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}

/**
 * Format a date+time pair as an iCal DTSTART/DTEND value (UTC).
 *
 * @param date       ISO date string: "YYYY-MM-DD"
 * @param time       "HH:MM" (24-hour, local/UTC)
 * @param addMinutes optional duration offset in minutes (used when there is no
 *                   explicit endTime — defaults to 0)
 */
export function formatICalDate(date: string, time: string, addMinutes = 0): string {
  const d = new Date(`${date}T${time}:00`);
  d.setMinutes(d.getMinutes() + addMinutes);
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/** Escape special characters for iCal text property values (RFC 5545 §3.3.11). */
export function icalEscape(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}
