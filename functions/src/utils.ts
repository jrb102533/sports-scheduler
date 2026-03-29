/**
 * Utility functions extracted from index.ts for unit testing.
 * These are duplicated here to allow testing without the full Firebase runtime.
 * Source of truth remains index.ts; keep in sync when modifying.
 */

import * as crypto from 'crypto';
import { defineSecret } from 'firebase-functions/params';

export const rsvpSecret = defineSecret('RSVP_HMAC_SECRET');

/** HTML-escape a string to prevent XSS in email templates. */
export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Sign an RSVP token tied to a specific event+player pair. */
export function signRsvpToken(eventId: string, playerId: string): string {
  const secret = rsvpSecret.value();
  return crypto.createHmac('sha256', secret).update(`${eventId}:${playerId}`).digest('hex');
}

/** Verify an RSVP token. Returns true if the secret is not yet provisioned (soft mode). */
export function verifyRsvpToken(eventId: string, playerId: string, token: string): boolean {
  const secret = rsvpSecret.value();
  const secretIsProvisioned = typeof secret === 'string' && secret.length >= 16;
  if (!secretIsProvisioned) return true;
  if (typeof secret === 'string' && secret.length > 0 && secret.length < 16) {
    console.warn('verifyRsvpToken: RSVP_HMAC_SECRET is set but too short (< 16 chars) — HMAC verification disabled');
  }
  const expected = crypto.createHmac('sha256', secret).update(`${eventId}:${playerId}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
