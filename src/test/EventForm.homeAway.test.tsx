/**
 * EventForm — home/away field clearing on edit
 *
 * Regression test for "Skywalkers vs Skywalkers" bug:
 *   When a game is edited from away→home (or home→away), the stale
 *   homeTeamId/awayTeamId from the original event must be stripped before
 *   the update is written. Without the fix, ...editEvent spread preserved
 *   the old awayTeamId and the EventCard showed the team playing against itself.
 *
 * Strategy: test the merge logic directly (no component render required).
 * The fix is the destructure+spread pattern on lines 260–261 of EventForm.tsx:
 *   const { homeTeamId: _ht, awayTeamId: _at, opponentId: _oi, opponentName: _on, ...editBase } = editEvent;
 *   updateEvent({ ...editBase, ...optionals });
 *
 * These tests verify that pattern produces the correct output for all
 * home↔away transitions and opponent-clearing scenarios.
 */

import { describe, it, expect } from 'vitest';
import type { ScheduledEvent } from '@/types';

// ── Mirror of the fix in EventForm.doSave ─────────────────────────────────────

/**
 * Mirrors the EventForm edit-merge logic after the fix.
 * Strips stale home/away/opponent fields, then re-applies optionals.
 */
function mergeEventEdit(
  editEvent: ScheduledEvent,
  optionals: Partial<ScheduledEvent>,
): ScheduledEvent {
  const {
    homeTeamId: _ht,
    awayTeamId: _at,
    opponentId: _oi,
    opponentName: _on,
    ...editBase
  } = editEvent;
  return { ...editBase, ...optionals } as ScheduledEvent;
}

/** Mirrors EventForm.doSave: builds optionals from the form state. */
function buildOptionals(params: {
  isHome: boolean;
  selectedTeamId: string;
  opponentName?: string;
  opponentId?: string;
}): Partial<ScheduledEvent> {
  const effectiveHomeTeamId = params.isHome ? params.selectedTeamId : '';
  const effectiveAwayTeamId = params.isHome ? '' : params.selectedTeamId;
  return {
    ...(effectiveHomeTeamId ? { homeTeamId: effectiveHomeTeamId } : {}),
    ...(effectiveAwayTeamId ? { awayTeamId: effectiveAwayTeamId } : {}),
    ...(params.opponentId ? { opponentId: params.opponentId } : {}),
    ...(params.opponentName ? { opponentName: params.opponentName } : {}),
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE: Pick<ScheduledEvent, 'id' | 'title' | 'type' | 'status' | 'date' | 'startTime' | 'teamIds' | 'isRecurring' | 'createdAt' | 'updatedAt'> = {
  id: 'evt-001',
  title: 'Game',
  type: 'game',
  status: 'scheduled',
  date: '2026-06-01',
  startTime: '10:00',
  teamIds: ['team-sky'],
  isRecurring: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const TEAM_ID = 'team-sky';

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('EventForm save logic — home/away field clearing (regression: Skywalkers vs Skywalkers)', () => {

  // ── Core regression ──────────────────────────────────────────────────────────

  it('away→home: awayTeamId is cleared, homeTeamId set', () => {
    const awayGame: ScheduledEvent = {
      ...BASE,
      awayTeamId: TEAM_ID,      // original: we are the away team
      opponentName: 'Rebels',
      opponentId: 'opp-rebels',
    };

    const optionals = buildOptionals({
      isHome: true,              // user switched to Home in the form
      selectedTeamId: TEAM_ID,
      opponentName: 'Rebels',
      opponentId: 'opp-rebels',
    });

    const result = mergeEventEdit(awayGame, optionals);

    expect(result.homeTeamId).toBe(TEAM_ID);
    expect(result.awayTeamId).toBeUndefined(); // must not survive
    // Before the fix: result.awayTeamId === TEAM_ID (same as homeTeamId) → "Skywalkers vs Skywalkers"
  });

  it('home→away: homeTeamId is cleared, awayTeamId set', () => {
    const homeGame: ScheduledEvent = {
      ...BASE,
      homeTeamId: TEAM_ID,
      opponentName: 'Rebels',
      opponentId: 'opp-rebels',
    };

    const optionals = buildOptionals({
      isHome: false,
      selectedTeamId: TEAM_ID,
      opponentName: 'Rebels',
      opponentId: 'opp-rebels',
    });

    const result = mergeEventEdit(homeGame, optionals);

    expect(result.awayTeamId).toBe(TEAM_ID);
    expect(result.homeTeamId).toBeUndefined();
  });

  it('home game re-saved as home: homeTeamId preserved, awayTeamId absent', () => {
    const homeGame: ScheduledEvent = {
      ...BASE,
      homeTeamId: TEAM_ID,
      opponentName: 'Rebels',
    };

    const optionals = buildOptionals({
      isHome: true,
      selectedTeamId: TEAM_ID,
      opponentName: 'Rebels',
    });

    const result = mergeEventEdit(homeGame, optionals);

    expect(result.homeTeamId).toBe(TEAM_ID);
    expect(result.awayTeamId).toBeUndefined();
  });

  it('away game re-saved as away: awayTeamId preserved, homeTeamId absent', () => {
    const awayGame: ScheduledEvent = {
      ...BASE,
      awayTeamId: TEAM_ID,
      opponentName: 'Rebels',
    };

    const optionals = buildOptionals({
      isHome: false,
      selectedTeamId: TEAM_ID,
      opponentName: 'Rebels',
    });

    const result = mergeEventEdit(awayGame, optionals);

    expect(result.awayTeamId).toBe(TEAM_ID);
    expect(result.homeTeamId).toBeUndefined();
  });

  // ── Opponent clearing ────────────────────────────────────────────────────────

  it('clearing the opponent name removes opponentName and opponentId', () => {
    const gameWithOpponent: ScheduledEvent = {
      ...BASE,
      homeTeamId: TEAM_ID,
      opponentName: 'Rebels',
      opponentId: 'opp-rebels',
    };

    // User cleared the opponent name field → trimmed = '' → not included in optionals
    const optionals = buildOptionals({
      isHome: true,
      selectedTeamId: TEAM_ID,
      opponentName: '',  // cleared
    });

    const result = mergeEventEdit(gameWithOpponent, optionals);

    expect(result.opponentName).toBeUndefined();
    expect(result.opponentId).toBeUndefined();
  });

  // ── No self-match is ever produced ──────────────────────────────────────────

  it('result never has homeTeamId === awayTeamId', () => {
    const scenarios = [
      { isHome: true,  original: { awayTeamId: TEAM_ID, homeTeamId: TEAM_ID } }, // corrupted data
      { isHome: false, original: { homeTeamId: TEAM_ID, awayTeamId: TEAM_ID } }, // corrupted data
      { isHome: true,  original: { awayTeamId: TEAM_ID } },                       // away→home
      { isHome: false, original: { homeTeamId: TEAM_ID } },                       // home→away
    ];

    for (const { isHome, original } of scenarios) {
      const event: ScheduledEvent = { ...BASE, ...original, opponentName: 'Rebels' };
      const optionals = buildOptionals({ isHome, selectedTeamId: TEAM_ID, opponentName: 'Rebels' });
      const result = mergeEventEdit(event, optionals);

      expect(
        result.homeTeamId === result.awayTeamId && result.homeTeamId !== undefined,
        `homeTeamId === awayTeamId === ${result.homeTeamId} for isHome=${isHome}`,
      ).toBe(false);
    }
  });
});
