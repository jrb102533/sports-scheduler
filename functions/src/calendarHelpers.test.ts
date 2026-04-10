import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock firebase-functions/params so calendarHelpers can be imported without a
// live Firebase environment.  The mock factory returns a secret stub whose
// `.value()` returns an empty string by default; individual tests override it
// via setSecret().
// ---------------------------------------------------------------------------

let _secretValue = '';

vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({
    value: vi.fn(() => _secretValue),
  })),
}));

// Import after mocks are registered.
import {
  signCalendarToken,
  verifyCalendarToken,
  formatICalDate,
  icalEscape,
} from './calendarHelpers';

function setSecret(val: string) {
  _secretValue = val;
}

// ---------------------------------------------------------------------------
// icalEscape()
// ---------------------------------------------------------------------------

describe('icalEscape()', () => {
  it('escapes a single backslash to double backslash', () => {
    expect(icalEscape('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('escapes semicolons', () => {
    expect(icalEscape('a;b;c')).toBe('a\\;b\\;c');
  });

  it('escapes commas', () => {
    expect(icalEscape('home, away')).toBe('home\\, away');
  });

  it('escapes newlines to \\n literal', () => {
    expect(icalEscape('line1\nline2')).toBe('line1\\nline2');
  });

  it('leaves plain alphanumeric text unchanged', () => {
    expect(icalEscape('Lions vs Bears')).toBe('Lions vs Bears');
  });

  it('escapes multiple special characters in one string', () => {
    // Backslash must be escaped first, then the others
    expect(icalEscape('notes\\one;two,three\nfour')).toBe(
      'notes\\\\one\\;two\\,three\\nfour',
    );
  });

  it('handles an empty string without throwing', () => {
    expect(icalEscape('')).toBe('');
  });

  it('does NOT escape colons (RFC 5545 colons are safe in TEXT values)', () => {
    expect(icalEscape('12:00 PM')).toBe('12:00 PM');
  });
});

// ---------------------------------------------------------------------------
// formatICalDate()
// ---------------------------------------------------------------------------

describe('formatICalDate()', () => {
  it('formats a basic date+time to iCal UTC format', () => {
    // "2026-06-15T10:30:00" parsed as local time — we just verify shape.
    const result = formatICalDate('2026-06-15', '10:30');
    expect(result).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('produces output that contains the expected date digits', () => {
    const result = formatICalDate('2026-06-15', '10:30');
    expect(result).toContain('20260615');
  });

  it('applies addMinutes offset to produce end time', () => {
    // Start 09:00, addMinutes=60 → 10:00 in the same timezone offset
    const start = formatICalDate('2026-06-15', '09:00', 0);
    const end = formatICalDate('2026-06-15', '09:00', 60);

    // Parse the timestamps back as UTC to compare
    const parseIcal = (s: string) =>
      new Date(
        `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`,
      ).getTime();

    expect(parseIcal(end) - parseIcal(start)).toBe(60 * 60 * 1000);
  });

  it('defaults addMinutes to 0 when not supplied', () => {
    const withZero = formatICalDate('2026-06-15', '14:00', 0);
    const withDefault = formatICalDate('2026-06-15', '14:00');
    expect(withDefault).toBe(withZero);
  });

  it('handles midnight (00:00) without wrapping to the previous day', () => {
    const result = formatICalDate('2026-06-15', '00:00');
    expect(result).toContain('20260615');
  });

  it('handles minute roll-over when addMinutes crosses the hour boundary', () => {
    // 23:45 + 30 min → 00:15 next day
    const result = formatICalDate('2026-06-15', '23:45', 30);
    expect(result).toMatch(/^\d{8}T\d{6}Z$/);
    // Should not contain the original date — it rolled over to 2026-06-16
    expect(result).not.toContain('T234500Z');
  });

  it('output contains no hyphens or colons (stripped for iCal)', () => {
    const result = formatICalDate('2026-06-15', '10:30');
    expect(result).not.toMatch(/[-:]/);
  });

  it('ends with Z (UTC designator)', () => {
    const result = formatICalDate('2026-06-15', '10:30');
    expect(result.endsWith('Z')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// signCalendarToken()
// ---------------------------------------------------------------------------

describe('signCalendarToken()', () => {
  const SECRET = 'test-ical-secret-long-enough-32ch';

  beforeEach(() => {
    setSecret(SECRET);
  });

  it('returns a 64-character hex string', () => {
    const token = signCalendarToken('user-abc');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same token for the same uid and secret', () => {
    const t1 = signCalendarToken('user-abc');
    const t2 = signCalendarToken('user-abc');
    expect(t1).toBe(t2);
  });

  it('returns different tokens for different uids', () => {
    const t1 = signCalendarToken('user-abc');
    const t2 = signCalendarToken('user-xyz');
    expect(t1).not.toBe(t2);
  });

  it('returns different tokens when the secret changes', () => {
    setSecret(SECRET);
    const t1 = signCalendarToken('user-abc');
    setSecret('completely-different-secret-value');
    const t2 = signCalendarToken('user-abc');
    expect(t1).not.toBe(t2);
  });
});

// ---------------------------------------------------------------------------
// verifyCalendarToken()
// ---------------------------------------------------------------------------

describe('verifyCalendarToken()', () => {
  const SECRET = 'test-ical-secret-long-enough-32ch';

  beforeEach(() => {
    setSecret(SECRET);
  });

  it('returns true for a token signed with the same uid and secret', () => {
    const token = signCalendarToken('user-abc');
    expect(verifyCalendarToken('user-abc', token)).toBe(true);
  });

  it('returns false when the uid does not match the token', () => {
    const token = signCalendarToken('user-abc');
    expect(verifyCalendarToken('user-xyz', token)).toBe(false);
  });

  it('returns false for a token from a different secret', () => {
    setSecret(SECRET);
    const token = signCalendarToken('user-abc');
    // Rotate the secret
    setSecret('rotated-secret-is-totally-different');
    expect(verifyCalendarToken('user-abc', token)).toBe(false);
  });

  it('returns false for a completely fabricated hex token', () => {
    const fakeToken = 'a'.repeat(64);
    expect(verifyCalendarToken('user-abc', fakeToken)).toBe(false);
  });

  it('returns false for an empty token string', () => {
    expect(verifyCalendarToken('user-abc', '')).toBe(false);
  });

  it('returns false for a non-hex token that would throw on Buffer.from', () => {
    // 'zz' is not valid hex — the catch block should return false
    expect(verifyCalendarToken('user-abc', 'zz-not-hex-at-all')).toBe(false);
  });

  it('returns false for a token of the wrong length (truncated)', () => {
    const token = signCalendarToken('user-abc');
    const truncated = token.slice(0, 32); // 16 bytes instead of 32
    expect(verifyCalendarToken('user-abc', truncated)).toBe(false);
  });

  it('is consistent — sign then verify round-trip succeeds for multiple uids', () => {
    const uids = ['uid-001', 'uid-002', 'admin-999', 'coach-abc-def'];
    for (const uid of uids) {
      const token = signCalendarToken(uid);
      expect(verifyCalendarToken(uid, token)).toBe(true);
    }
  });

  it('does not accept a token signed for a different uid even with same length', () => {
    const tokenForA = signCalendarToken('user-aaa');
    const tokenForB = signCalendarToken('user-bbb');
    // Swap them — neither should verify for the other uid
    expect(verifyCalendarToken('user-aaa', tokenForB)).toBe(false);
    expect(verifyCalendarToken('user-bbb', tokenForA)).toBe(false);
  });
});
