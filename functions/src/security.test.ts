import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Mock Firebase Functions params so utils.ts can be imported without a live
// Firebase environment.  The mock factory returns a secret stub whose
// `.value()` returns an empty string by default; individual tests override
// the return value via the exported `mockSecretValue` helper.
// ---------------------------------------------------------------------------

let _secretValue = '';

vi.mock('firebase-functions/params', () => ({
  defineSecret: vi.fn(() => ({
    value: vi.fn(() => _secretValue),
  })),
}));

// Import after mocks are registered
import { verifyRsvpToken, signRsvpToken, esc } from './utils';

// Helper used by tests to change what rsvpSecret.value() returns.
// Because defineSecret is called at module-load time, we must reach into the
// mock closure via the shared _secretValue variable.
function setSecret(val: string) {
  _secretValue = val;
}

// ---------------------------------------------------------------------------
// esc()
// ---------------------------------------------------------------------------

describe('esc()', () => {
  it('escapes < to &lt;', () => {
    expect(esc('<')).toBe('&lt;');
  });

  it('escapes > to &gt;', () => {
    expect(esc('>')).toBe('&gt;');
  });

  it('escapes & to &amp;', () => {
    expect(esc('&')).toBe('&amp;');
  });

  it('escapes " to &quot;', () => {
    expect(esc('"')).toBe('&quot;');
  });

  it("escapes ' to &#39;", () => {
    expect(esc("'")).toBe('&#39;');
  });

  it('leaves a clean string unchanged', () => {
    expect(esc('Hello World')).toBe('Hello World');
  });

  it('fully escapes a script injection string', () => {
    expect(esc('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('handles a mixed injection string with quotes and ampersands', () => {
    expect(esc('<a href="test&foo">it\'s</a>')).toBe(
      '&lt;a href=&quot;test&amp;foo&quot;&gt;it&#39;s&lt;/a&gt;'
    );
  });
});

// ---------------------------------------------------------------------------
// signRsvpToken()
// ---------------------------------------------------------------------------

describe('signRsvpToken()', () => {
  const SECRET = 'test-secret-value-for-signing';

  beforeEach(() => {
    setSecret(SECRET);
  });

  it('returns a hex string', () => {
    const token = signRsvpToken('event1', 'player1');
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic — same inputs always produce the same token', () => {
    const t1 = signRsvpToken('event1', 'player1');
    const t2 = signRsvpToken('event1', 'player1');
    expect(t1).toBe(t2);
  });

  it('produces different tokens for different eventId', () => {
    const t1 = signRsvpToken('event1', 'player1');
    const t2 = signRsvpToken('event2', 'player1');
    expect(t1).not.toBe(t2);
  });

  it('produces different tokens for different playerId', () => {
    const t1 = signRsvpToken('event1', 'player1');
    const t2 = signRsvpToken('event1', 'player2');
    expect(t1).not.toBe(t2);
  });

  it('matches a manually computed HMAC-SHA256 hex digest', () => {
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update('event1:player1')
      .digest('hex');
    expect(signRsvpToken('event1', 'player1')).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// verifyRsvpToken()
// ---------------------------------------------------------------------------

describe('verifyRsvpToken()', () => {
  const STRONG_SECRET = 'this-secret-is-long-enough-16+';

  beforeEach(() => {
    vi.restoreAllMocks();
    setSecret('');
  });

  // Path 1: secret is empty string → bypass (not yet provisioned)
  it('returns true when secret is empty string (not provisioned)', () => {
    setSecret('');
    expect(verifyRsvpToken('event1', 'player1', 'anytoken')).toBe(true);
  });

  // Path 2: secret is set but shorter than 16 chars → bypass
  it('returns true when secret is shorter than 16 chars', () => {
    setSecret('short');
    expect(verifyRsvpToken('event1', 'player1', 'anytoken')).toBe(true);
  });

  // Dead-code finding: the console.warn inside verifyRsvpToken is unreachable.
  // The condition `secret.length > 0 && secret.length < 16` comes AFTER the
  // early-return `if (!secretIsProvisioned) return true`, which already covers
  // every case where length < 16 (including length === 0).  The warn therefore
  // NEVER fires.  This test documents that confirmed behaviour.
  it('does NOT fire console.warn even when secret is short (dead-code path)', () => {
    setSecret('short');
    const warnSpy = vi.spyOn(console, 'warn');
    verifyRsvpToken('event1', 'player1', 'anytoken');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // Path 3: secret >= 16 chars, valid token → returns true
  it('returns true when secret is provisioned and token is valid', () => {
    setSecret(STRONG_SECRET);
    const token = crypto
      .createHmac('sha256', STRONG_SECRET)
      .update('event1:player1')
      .digest('hex');
    expect(verifyRsvpToken('event1', 'player1', token)).toBe(true);
  });

  // Path 4: secret >= 16 chars, wrong token → returns false
  it('returns false when secret is provisioned and token is invalid', () => {
    setSecret(STRONG_SECRET);
    const wrongToken = crypto
      .createHmac('sha256', STRONG_SECRET)
      .update('event1:player2') // wrong playerId
      .digest('hex');
    expect(verifyRsvpToken('event1', 'player1', wrongToken)).toBe(false);
  });

  // Path 5: secret >= 16 chars, malformed (non-hex) token → returns false, no throw
  it('returns false without throwing when token is malformed (non-hex)', () => {
    setSecret(STRONG_SECRET);
    expect(() => verifyRsvpToken('event1', 'player1', 'not-hex!!')).not.toThrow();
    expect(verifyRsvpToken('event1', 'player1', 'not-hex!!')).toBe(false);
  });

  // Path 5b: completely empty token string → returns false, no throw
  it('returns false without throwing when token is an empty string', () => {
    setSecret(STRONG_SECRET);
    expect(verifyRsvpToken('event1', 'player1', '')).toBe(false);
  });
});
