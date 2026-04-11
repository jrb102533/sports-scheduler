/**
 * useDmStore — dmThreadId() unit tests
 *
 * Covers:
 *   1. Sorts UIDs lexicographically regardless of call order
 *   2. Identical UIDs produce a consistent (though degenerate) id
 *   3. Format is exactly "uid1_uid2" — no extra separators or whitespace
 *   4. Output is symmetric: dmThreadId(a, b) === dmThreadId(b, a)
 */

import { describe, it, expect } from 'vitest';
import { dmThreadId } from './useDmStore';

describe('dmThreadId()', () => {
  it('returns sorted UIDs joined by underscore', () => {
    expect(dmThreadId('charlie', 'alice')).toBe('alice_charlie');
  });

  it('is symmetric — argument order does not matter', () => {
    const aFirst = dmThreadId('userZ', 'userA');
    const bFirst = dmThreadId('userA', 'userZ');
    expect(aFirst).toBe(bFirst);
  });

  it('places the lexicographically smaller UID first', () => {
    const id = dmThreadId('uid_999', 'uid_001');
    const [first, second] = id.split('_');
    // Both parts together contain "uid" so we compare the full sorted result
    expect(id).toBe('uid_001_uid_999');
    void first; void second; // used above
  });

  it('uses underscore as the sole separator', () => {
    const id = dmThreadId('abc', 'xyz');
    expect(id).toBe('abc_xyz');
    // No extra separators or whitespace
    expect(id).not.toMatch(/\s/);
  });

  it('handles Firebase-style UID strings (alphanumeric with mixed case)', () => {
    const uid1 = 'ABCDEF123456';
    const uid2 = 'abcdef123456';
    // Uppercase letters sort before lowercase in standard string comparison
    const id = dmThreadId(uid1, uid2);
    expect(id).toBe(`${uid1}_${uid2}`);
    // Reversed call produces the same id
    expect(dmThreadId(uid2, uid1)).toBe(id);
  });

  it('produces the same id for identical UIDs (degenerate case)', () => {
    const id = dmThreadId('sameUid', 'sameUid');
    expect(id).toBe('sameUid_sameUid');
  });
});
