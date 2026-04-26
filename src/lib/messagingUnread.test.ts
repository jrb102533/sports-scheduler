/**
 * messagingUnread — unit tests
 *
 * Tests cover the load-bearing semantics:
 *   - isTeamUnread / isThreadUnread return false when either side is missing
 *   - First-view of a team with activity is treated as unread
 *   - Marking a team/thread as read clears the unread state
 *   - countUnreadThreads aggregates correctly
 *   - localStorage failures degrade gracefully to in-memory state
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isTeamUnread,
  markTeamRead,
  isThreadUnread,
  markThreadRead,
  countUnreadThreads,
  _resetMessagingUnreadForTests,
} from './messagingUnread';

beforeEach(() => {
  _resetMessagingUnreadForTests();
});

// ─── isTeamUnread ────────────────────────────────────────────────────────────

describe('isTeamUnread', () => {
  it('returns false when team has no lastMessageAt (no activity yet)', () => {
    expect(isTeamUnread('t1', undefined)).toBe(false);
    expect(isTeamUnread('t1', null)).toBe(false);
  });

  it('returns true on first encounter with a team that has activity', () => {
    // Never marked as read; team has lastMessageAt → unread
    expect(isTeamUnread('t1', '2026-04-26T12:00:00Z')).toBe(true);
  });

  it('returns false after markTeamRead with the same lastMessageAt', () => {
    const ts = '2026-04-26T12:00:00Z';
    markTeamRead('t1', ts);
    expect(isTeamUnread('t1', ts)).toBe(false);
  });

  it('returns true again when a newer lastMessageAt arrives after a read', () => {
    markTeamRead('t1', '2026-04-26T12:00:00Z');
    expect(isTeamUnread('t1', '2026-04-26T12:05:00Z')).toBe(true);
  });

  it('does not bleed unread state between different teams', () => {
    markTeamRead('t1', '2026-04-26T12:00:00Z');
    expect(isTeamUnread('t1', '2026-04-26T12:00:00Z')).toBe(false);
    expect(isTeamUnread('t2', '2026-04-26T12:00:00Z')).toBe(true); // never marked
  });
});

// ─── isThreadUnread ──────────────────────────────────────────────────────────

describe('isThreadUnread', () => {
  it('mirrors isTeamUnread semantics for DM threads', () => {
    expect(isThreadUnread('th1', undefined)).toBe(false);
    expect(isThreadUnread('th1', '2026-04-26T12:00:00Z')).toBe(true);

    markThreadRead('th1', '2026-04-26T12:00:00Z');
    expect(isThreadUnread('th1', '2026-04-26T12:00:00Z')).toBe(false);

    expect(isThreadUnread('th1', '2026-04-26T13:00:00Z')).toBe(true);
  });

  it('namespaces team and thread keys separately (no cross-contamination)', () => {
    // A team and a thread with identical IDs should not share unread state.
    markTeamRead('shared-id', '2026-04-26T12:00:00Z');
    expect(isThreadUnread('shared-id', '2026-04-26T12:00:00Z')).toBe(true);
  });
});

// ─── markTeamRead defaults ───────────────────────────────────────────────────

describe('markTeamRead defaults', () => {
  it('uses current time when no timestamp is provided', () => {
    const before = new Date().toISOString();
    markTeamRead('t1');
    const after = new Date(Date.now() + 1).toISOString();
    // Now any older lastMessageAt should be considered read.
    expect(isTeamUnread('t1', before)).toBe(false);
    // A future lastMessageAt is unread.
    expect(isTeamUnread('t1', after)).toBe(true);
  });
});

// ─── countUnreadThreads ─────────────────────────────────────────────────────

describe('countUnreadThreads', () => {
  it('counts threads with unread activity', () => {
    markThreadRead('th1', '2026-04-26T11:00:00Z');
    // th1 — read up to 11:00, latest is 11:00 → not unread
    // th2 — never read, has activity → unread
    // th3 — never read, no activity → not unread (lastMessageAt empty)
    const threads = [
      { id: 'th1', lastMessageAt: '2026-04-26T11:00:00Z' },
      { id: 'th2', lastMessageAt: '2026-04-26T12:00:00Z' },
      { id: 'th3', lastMessageAt: '' },
    ];
    expect(countUnreadThreads(threads)).toBe(1);
  });

  it('returns 0 for an empty list', () => {
    expect(countUnreadThreads([])).toBe(0);
  });
});

// ─── localStorage resilience ────────────────────────────────────────────────

describe('localStorage failure degradation', () => {
  it('falls back to in-memory state when localStorage.setItem throws', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => { throw new Error('QuotaExceededError'); });

    // Should not throw despite localStorage being broken
    markTeamRead('t1', '2026-04-26T12:00:00Z');
    // And the in-memory fallback should still work for the same call
    expect(isTeamUnread('t1', '2026-04-26T12:00:00Z')).toBe(false);

    setItemSpy.mockRestore();
  });

  it('falls back to in-memory state when localStorage.getItem throws', () => {
    // First write normally
    markTeamRead('t1', '2026-04-26T12:00:00Z');

    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => { throw new Error('SecurityError'); });

    // Read should not throw, returns from memory fallback (which is empty
    // since the previous markTeamRead went to localStorage). With a broken
    // getItem and no in-memory entry, "never read" → unread.
    expect(isTeamUnread('t1', '2026-04-26T12:00:00Z')).toBe(true);

    getItemSpy.mockRestore();
  });
});
