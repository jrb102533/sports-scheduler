/**
 * constants — getAttendanceThreshold and isAttendanceWarningEnabled
 *
 * Pure functions that determine whether attendance warnings fire and
 * what the minimum player threshold is.
 *
 * Behaviours under test:
 *   getAttendanceThreshold
 *     - Returns 7 (default) when team is undefined
 *     - Returns sport-specific forfeit threshold when team has no custom threshold
 *     - Returns custom threshold when team.attendanceWarningThreshold is set
 *     - Returns custom threshold when set to 0 (explicit override)
 *   isAttendanceWarningEnabled
 *     - Returns true when team is undefined (default-on)
 *     - Returns true when team.attendanceWarningsEnabled is true
 *     - Returns false when team.attendanceWarningsEnabled is false
 *     - Returns true when team.attendanceWarningsEnabled is undefined (default-on)
 */

import { describe, it, expect } from 'vitest';
import type { Team } from '@/types';
import { getAttendanceThreshold, isAttendanceWarningEnabled, SPORT_FORFEIT_THRESHOLDS } from '@/constants';

function makeTeam(overrides: Partial<Team>): Team {
  return {
    id: 'team-1',
    name: 'Hawks',
    sportType: 'soccer',
    color: '#ef4444',
    createdBy: 'uid-1',
    attendanceWarningsEnabled: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as Team;
}

// ── getAttendanceThreshold ─────────────────────────────────────────────────────

describe('getAttendanceThreshold', () => {
  it('returns 7 when team is undefined', () => {
    expect(getAttendanceThreshold(undefined)).toBe(7);
  });

  it('returns the soccer forfeit threshold (7) for a soccer team with no custom threshold', () => {
    const team = makeTeam({ sportType: 'soccer', attendanceWarningThreshold: undefined });
    expect(getAttendanceThreshold(team)).toBe(SPORT_FORFEIT_THRESHOLDS.soccer);
    expect(SPORT_FORFEIT_THRESHOLDS.soccer).toBe(7);
  });

  it('returns the basketball forfeit threshold (5) for a basketball team with no custom threshold', () => {
    const team = makeTeam({ sportType: 'basketball', attendanceWarningThreshold: undefined });
    expect(getAttendanceThreshold(team)).toBe(SPORT_FORFEIT_THRESHOLDS.basketball);
    expect(SPORT_FORFEIT_THRESHOLDS.basketball).toBe(5);
  });

  it('returns the baseball forfeit threshold (9) for a baseball team with no custom threshold', () => {
    const team = makeTeam({ sportType: 'baseball', attendanceWarningThreshold: undefined });
    expect(getAttendanceThreshold(team)).toBe(9);
  });

  it('returns the custom threshold when team.attendanceWarningThreshold is set', () => {
    const team = makeTeam({ sportType: 'soccer', attendanceWarningThreshold: 4 });
    expect(getAttendanceThreshold(team)).toBe(4);
  });

  it('returns custom threshold of 1 (minimum override)', () => {
    const team = makeTeam({ sportType: 'soccer', attendanceWarningThreshold: 1 });
    expect(getAttendanceThreshold(team)).toBe(1);
  });

  it('returns 0 when custom threshold is explicitly set to 0', () => {
    const team = makeTeam({ sportType: 'soccer', attendanceWarningThreshold: 0 });
    expect(getAttendanceThreshold(team)).toBe(0);
  });
});

// ── isAttendanceWarningEnabled ─────────────────────────────────────────────────

describe('isAttendanceWarningEnabled', () => {
  it('returns true when team is undefined (default-on)', () => {
    expect(isAttendanceWarningEnabled(undefined)).toBe(true);
  });

  it('returns true when team.attendanceWarningsEnabled is true', () => {
    const team = makeTeam({ attendanceWarningsEnabled: true });
    expect(isAttendanceWarningEnabled(team)).toBe(true);
  });

  it('returns false when team.attendanceWarningsEnabled is false', () => {
    const team = makeTeam({ attendanceWarningsEnabled: false });
    expect(isAttendanceWarningEnabled(team)).toBe(false);
  });

  it('returns true when team.attendanceWarningsEnabled is undefined (default-on)', () => {
    const team = makeTeam({ attendanceWarningsEnabled: undefined });
    expect(isAttendanceWarningEnabled(team)).toBe(true);
  });
});
