/**
 * Unit tests for RBAC helper functions.
 *
 * These helpers underpin all Cloud Function ownership assertions after Phase 3.
 * Covers: array path, legacy scalar fallback, empty-array edge case, and
 * array-takes-precedence scenarios.
 *
 * Coverage:
 * isCoachOfTeamDoc
 *   1.  uid in coachIds → true
 *   2.  uid NOT in coachIds → false
 *   3.  coachIds absent, coachId matches → true (legacy fallback)
 *   4.  coachIds absent, createdBy matches → true (legacy fallback)
 *   5.  coachIds is empty array → false (no legacy fallback; empty array is conclusive)
 *   6.  uid in coachIds but not coachId → true (array takes precedence)
 *
 * isManagerOfLeagueDoc
 *   7.  uid in managerIds → true
 *   8.  uid NOT in managerIds → false
 *   9.  managerIds absent, managedBy matches → true (legacy fallback)
 *   10. managerIds is empty array → false (no legacy fallback; empty array is conclusive)
 *   11. uid in managerIds but not managedBy → true (array takes precedence)
 */

import { describe, it, expect } from 'vitest';
import { isCoachOfTeamDoc, isManagerOfLeagueDoc } from './rbacHelpers';

const UID = 'user-abc';
const OTHER_UID = 'user-xyz';

// ─── isCoachOfTeamDoc ────────────────────────────────────────────────────────

describe('isCoachOfTeamDoc', () => {
  it('returns true if uid is in coachIds array', () => {
    const teamData = { coachIds: [UID, OTHER_UID] };
    expect(isCoachOfTeamDoc(teamData, UID)).toBe(true);
  });

  it('returns false if uid is NOT in coachIds array', () => {
    const teamData = { coachIds: [OTHER_UID] };
    expect(isCoachOfTeamDoc(teamData, UID)).toBe(false);
  });

  it('falls back to coachId scalar when coachIds absent', () => {
    const teamData = { coachId: UID };
    expect(isCoachOfTeamDoc(teamData, UID)).toBe(true);
  });

  it('falls back to createdBy scalar when coachIds absent and coachId absent', () => {
    const teamData = { createdBy: UID };
    expect(isCoachOfTeamDoc(teamData, UID)).toBe(true);
  });

  it('returns false when coachIds is empty array (no legacy fallback confusion)', () => {
    // An empty array means the backfill ran but the team has no coaches —
    // the legacy scalars must NOT be consulted in this case.
    const teamData = { coachIds: [], coachId: UID, createdBy: UID };
    expect(isCoachOfTeamDoc(teamData, UID)).toBe(false);
  });

  it('array takes precedence — uid in coachIds but not coachId → true', () => {
    const teamData = { coachIds: [UID], coachId: OTHER_UID };
    expect(isCoachOfTeamDoc(teamData, UID)).toBe(true);
  });
});

// ─── isManagerOfLeagueDoc ────────────────────────────────────────────────────

describe('isManagerOfLeagueDoc', () => {
  it('returns true if uid is in managerIds array', () => {
    const leagueData = { managerIds: [UID, OTHER_UID] };
    expect(isManagerOfLeagueDoc(leagueData, UID)).toBe(true);
  });

  it('returns false if uid is NOT in managerIds array', () => {
    const leagueData = { managerIds: [OTHER_UID] };
    expect(isManagerOfLeagueDoc(leagueData, UID)).toBe(false);
  });

  it('falls back to managedBy scalar when managerIds absent', () => {
    const leagueData = { managedBy: UID };
    expect(isManagerOfLeagueDoc(leagueData, UID)).toBe(true);
  });

  it('returns false when managerIds is empty array (no legacy fallback confusion)', () => {
    // An empty array means the backfill ran but the league has no managers —
    // the legacy managedBy scalar must NOT be consulted in this case.
    const leagueData = { managerIds: [], managedBy: UID };
    expect(isManagerOfLeagueDoc(leagueData, UID)).toBe(false);
  });

  it('array takes precedence — uid in managerIds but not managedBy → true', () => {
    const leagueData = { managerIds: [UID], managedBy: OTHER_UID };
    expect(isManagerOfLeagueDoc(leagueData, UID)).toBe(true);
  });
});
