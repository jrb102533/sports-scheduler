/**
 * firestoreToStandingRow — pure unit tests
 *
 * No JSX, no mocks, no Firebase needed.
 */

import { describe, it, expect } from 'vitest';
import { firestoreToStandingRow } from '@/lib/standingsUtils';
import type { StandingsDocument } from '@/types/standings';

function makeDoc(overrides: Partial<StandingsDocument> = {}): StandingsDocument {
  return {
    teamId: 'team-a',
    played: 5,
    won: 3,
    drawn: 1,
    lost: 1,
    goalsFor: 9,
    goalsAgainst: 4,
    points: 10,
    winPct: 0.6,
    rank: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('firestoreToStandingRow', () => {
  it('maps all Firestore document fields to TeamStandingRow fields correctly', () => {
    const row = firestoreToStandingRow(makeDoc(), 'Lions', '#ff0000');
    expect(row.teamId).toBe('team-a');
    expect(row.teamName).toBe('Lions');
    expect(row.teamColor).toBe('#ff0000');
    expect(row.gamesPlayed).toBe(5);
    expect(row.wins).toBe(3);
    expect(row.losses).toBe(1);
    expect(row.ties).toBe(1);
    expect(row.pointsFor).toBe(9);
    expect(row.pointsAgainst).toBe(4);
    expect(row.points).toBe(10);
    expect(row.winPercentage).toBe(0.6);
  });

  it('derives pointsDiff as goalsFor minus goalsAgainst', () => {
    const row = firestoreToStandingRow(makeDoc({ goalsFor: 9, goalsAgainst: 4 }), 'Lions', '#000');
    expect(row.pointsDiff).toBe(5);
  });

  it('produces a negative pointsDiff when goals-against exceeds goals-for', () => {
    const row = firestoreToStandingRow(makeDoc({ goalsFor: 2, goalsAgainst: 7 }), 'Tigers', '#000');
    expect(row.pointsDiff).toBe(-5);
  });

  it('produces zero pointsDiff when goals are equal', () => {
    const row = firestoreToStandingRow(makeDoc({ goalsFor: 4, goalsAgainst: 4 }), 'Eagles', '#000');
    expect(row.pointsDiff).toBe(0);
  });

  it('passes teamName and teamColor through unchanged', () => {
    const row = firestoreToStandingRow(makeDoc({ teamId: 'x' }), 'Rockets', '#abcdef');
    expect(row.teamName).toBe('Rockets');
    expect(row.teamColor).toBe('#abcdef');
  });

  it('preserves a winPct of 0 for a team with no wins', () => {
    const row = firestoreToStandingRow(makeDoc({ won: 0, winPct: 0 }), 'Cellar Dwellers', '#000');
    expect(row.winPercentage).toBe(0);
  });

  it('handles a team with a manualRankOverride present without error', () => {
    const doc = makeDoc({
      manualRankOverride: {
        rank: 3,
        note: 'Forfeit applied',
        scope: 'display',
        overriddenBy: 'uid-lm',
        overriddenAt: '2026-03-01T00:00:00.000Z',
      },
    });
    // The mapper does not surface manualRankOverride — it's StandingsTable's job.
    // Assert the row still maps cleanly.
    const row = firestoreToStandingRow(doc, 'Lions', '#000');
    expect(row.teamId).toBe('team-a');
    expect(row.points).toBe(10);
  });
});
