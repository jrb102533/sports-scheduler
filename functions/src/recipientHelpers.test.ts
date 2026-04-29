/**
 * recipientHelpers — unit tests
 *
 * Tests cover computeEventRecipients which is the pure shared function
 * consumed by the backfill script, the onEventWritten / onTeamMembershipChanged
 * triggers, and the dispatcher CF.
 */

import { describe, it, expect } from 'vitest';
import {
  computeEventRecipients,
  type RawTeamData,
  type RawPlayerData,
  type RawUserData,
  type RawParentUserData,
} from './recipientHelpers';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TEAM_ID = 'team-lions';
const TEAM_ID_2 = 'team-tigers';
const COACH_UID = 'uid-coach';
const COACH_UID_2 = 'uid-coach2';

function makeTeam(overrides: Partial<RawTeamData> = {}): RawTeamData {
  return { name: 'Lions', coachIds: [COACH_UID], ...overrides };
}

function makePlayer(overrides: Partial<RawPlayerData> = {}): RawPlayerData {
  return {
    uid: 'uid-player',
    firstName: 'Alice',
    lastName: 'Smith',
    email: 'alice@example.com',
    teamId: TEAM_ID,
    ...overrides,
  };
}

function makeCoachProfile(overrides: Partial<RawUserData> = {}): RawUserData {
  return { displayName: 'Coach Bob', email: 'bob@example.com', ...overrides };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('computeEventRecipients', () => {
  it('returns empty array when no teamIds', () => {
    const result = computeEventRecipients([], new Map(), new Map(), new Map());
    expect(result).toEqual([]);
  });

  it('returns empty array when teamIds present but maps are empty', () => {
    const result = computeEventRecipients([TEAM_ID], new Map(), new Map(), new Map());
    expect(result).toEqual([]);
  });

  it('includes coach recipient when coach has email', () => {
    const teams = new Map<string, RawTeamData>([[TEAM_ID, makeTeam()]]);
    const coaches = new Map<string, RawUserData>([[COACH_UID, makeCoachProfile()]]);
    const players = new Map<string, RawPlayerData[]>();

    const result = computeEventRecipients([TEAM_ID], players, coaches, teams);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      uid: COACH_UID,
      email: 'bob@example.com',
      name: 'Coach Bob',
      type: 'coach',
    });
  });

  it('omits coach when profile has no email', () => {
    const teams = new Map<string, RawTeamData>([[TEAM_ID, makeTeam()]]);
    const coaches = new Map<string, RawUserData>([[COACH_UID, { displayName: 'No Email Coach' }]]);
    const players = new Map<string, RawPlayerData[]>();

    const result = computeEventRecipients([TEAM_ID], players, coaches, teams);
    expect(result).toHaveLength(0);
  });

  it('includes player recipient with direct email', () => {
    const teams = new Map<string, RawTeamData>([[TEAM_ID, { name: 'Lions' }]]);
    const playerMap = new Map<string, RawPlayerData[]>([[TEAM_ID, [makePlayer()]]]);
    const coaches = new Map<string, RawUserData>();

    const result = computeEventRecipients([TEAM_ID], playerMap, coaches, teams);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      uid: 'uid-player',
      email: 'alice@example.com',
      name: 'Alice Smith',
      type: 'player',
    });
  });

  it('includes parent contact recipients', () => {
    const player = makePlayer({
      email: undefined, // no direct email
      parentContact: { parentName: 'Mom Smith', parentEmail: 'mom@example.com', uid: 'uid-mom' },
      parentContact2: { parentName: 'Dad Smith', parentEmail: 'dad@example.com', uid: 'uid-dad' },
    });
    const teams = new Map<string, RawTeamData>([[TEAM_ID, { name: 'Lions' }]]);
    const playerMap = new Map<string, RawPlayerData[]>([[TEAM_ID, [player]]]);

    const result = computeEventRecipients([TEAM_ID], playerMap, new Map(), teams);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ email: 'mom@example.com', type: 'parent', name: 'Mom Smith' });
    expect(result[1]).toMatchObject({ email: 'dad@example.com', type: 'parent', name: 'Dad Smith' });
  });

  it('deduplicates by email (case-insensitive) — first appearance wins', () => {
    // Coach and player share the same email address
    const teams = new Map<string, RawTeamData>([[TEAM_ID, makeTeam()]]);
    const coaches = new Map<string, RawUserData>([[COACH_UID, { email: 'shared@example.com', displayName: 'Coach' }]]);
    const player = makePlayer({ email: 'SHARED@EXAMPLE.COM' }); // uppercase variant
    const playerMap = new Map<string, RawPlayerData[]>([[TEAM_ID, [player]]]);

    const result = computeEventRecipients([TEAM_ID], playerMap, coaches, teams);

    // Coach processed first (coachIds before players), so only coach entry kept
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('coach');
  });

  it('handles multiple teams — all teams included', () => {
    const teams = new Map<string, RawTeamData>([
      [TEAM_ID, { name: 'Lions', coachIds: [COACH_UID] }],
      [TEAM_ID_2, { name: 'Tigers', coachIds: [COACH_UID_2] }],
    ]);
    const coaches = new Map<string, RawUserData>([
      [COACH_UID, { email: 'coach1@example.com', displayName: 'Coach One' }],
      [COACH_UID_2, { email: 'coach2@example.com', displayName: 'Coach Two' }],
    ]);
    const playerMap = new Map<string, RawPlayerData[]>([
      [TEAM_ID, [makePlayer({ email: 'player1@example.com' })]],
      [TEAM_ID_2, [makePlayer({ uid: 'uid-p2', email: 'player2@example.com' })]],
    ]);

    const result = computeEventRecipients([TEAM_ID, TEAM_ID_2], playerMap, coaches, teams);

    expect(result).toHaveLength(4);
    const emails = result.map(r => r.email);
    expect(emails).toContain('coach1@example.com');
    expect(emails).toContain('coach2@example.com');
    expect(emails).toContain('player1@example.com');
    expect(emails).toContain('player2@example.com');
  });

  it('uses email as fallback name when displayName absent for coach', () => {
    const teams = new Map<string, RawTeamData>([[TEAM_ID, makeTeam()]]);
    const coaches = new Map<string, RawUserData>([[COACH_UID, { email: 'coach@example.com' }]]); // no displayName
    const result = computeEventRecipients([TEAM_ID], new Map(), coaches, teams);

    expect(result[0].name).toBe('coach@example.com');
  });

  it('falls back to "Player" when player has no name fields', () => {
    const player = makePlayer({ firstName: undefined, lastName: undefined, email: 'anon@example.com' });
    const teams = new Map<string, RawTeamData>([[TEAM_ID, { name: 'Lions' }]]);
    const playerMap = new Map<string, RawPlayerData[]>([[TEAM_ID, [player]]]);

    const result = computeEventRecipients([TEAM_ID], playerMap, new Map(), teams);

    expect(result[0].name).toBe('Player');
  });

  it('generates parent name fallback when parentName absent', () => {
    const player = makePlayer({
      email: undefined,
      parentContact: { parentEmail: 'parent@example.com' }, // no parentName
    });
    const teams = new Map<string, RawTeamData>([[TEAM_ID, { name: 'Lions' }]]);
    const playerMap = new Map<string, RawPlayerData[]>([[TEAM_ID, [player]]]);

    const result = computeEventRecipients([TEAM_ID], playerMap, new Map(), teams);

    expect(result[0].name).toBe('Parent of Alice Smith');
  });

  it('skips team entirely when not in teamDataById', () => {
    // TEAM_ID not in teams map — should not throw, should return nothing
    const teams = new Map<string, RawTeamData>();
    const playerMap = new Map<string, RawPlayerData[]>([[TEAM_ID, [makePlayer()]]]);
    const coaches = new Map<string, RawUserData>();

    // Player data present but no team — players should still be included
    const result = computeEventRecipients([TEAM_ID], playerMap, coaches, teams);
    // No coachIds since team is unknown, but player email still comes through
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('alice@example.com');
  });

  it('uid is optional — parent contact without uid still included', () => {
    const player = makePlayer({
      email: undefined,
      parentContact: { parentEmail: 'nouid@example.com', parentName: 'Anonymous Parent' },
      // no uid on parentContact
    });
    const teams = new Map<string, RawTeamData>([[TEAM_ID, { name: 'Lions' }]]);
    const playerMap = new Map<string, RawPlayerData[]>([[TEAM_ID, [player]]]);

    const result = computeEventRecipients([TEAM_ID], playerMap, new Map(), teams);

    expect(result[0].uid).toBeUndefined();
    expect(result[0].email).toBe('nouid@example.com');
  });
});

// ─── Path B: registered parent users ─────────────────────────────────────────

function makeParentUser(overrides: Partial<RawParentUserData> = {}): RawParentUserData {
  return {
    uid: 'uid-parent-user',
    displayName: 'Jane Parent',
    email: 'jane@example.com',
    memberships: [{ role: 'parent', teamId: TEAM_ID }],
    ...overrides,
  };
}

describe('computeEventRecipients — path B registered parent users', () => {
  it('includes a registered parent user whose membership matches a teamId', () => {
    const teams = new Map<string, RawTeamData>([[TEAM_ID, { name: 'Lions' }]]);
    const parentUsers: RawParentUserData[] = [makeParentUser()];

    const result = computeEventRecipients([TEAM_ID], new Map(), new Map(), teams, parentUsers);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      uid: 'uid-parent-user',
      email: 'jane@example.com',
      name: 'Jane Parent',
      type: 'parent',
    });
  });

  it('excludes a registered parent user whose memberships do not match any event teamId', () => {
    const teams = new Map<string, RawTeamData>([[TEAM_ID, { name: 'Lions' }]]);
    const parentUsers: RawParentUserData[] = [
      makeParentUser({ memberships: [{ role: 'parent', teamId: 'team-other' }] }),
    ];

    const result = computeEventRecipients([TEAM_ID], new Map(), new Map(), teams, parentUsers);

    expect(result).toHaveLength(0);
  });

  it('path A + path B with no overlap — both parents included', () => {
    // Path A: embedded parentContact on a player
    const player = makePlayer({
      email: undefined,
      parentContact: { parentName: 'Path A Parent', parentEmail: 'path-a@example.com', uid: 'uid-a' },
    });
    const teams = new Map<string, RawTeamData>([[TEAM_ID, { name: 'Lions' }]]);
    const playerMap = new Map<string, RawPlayerData[]>([[TEAM_ID, [player]]]);

    // Path B: registered parent user with different email
    const parentUsers: RawParentUserData[] = [
      makeParentUser({ uid: 'uid-b', email: 'path-b@example.com', displayName: 'Path B Parent' }),
    ];

    const result = computeEventRecipients([TEAM_ID], playerMap, new Map(), teams, parentUsers);

    expect(result).toHaveLength(2);
    const emails = result.map((r) => r.email);
    expect(emails).toContain('path-a@example.com');
    expect(emails).toContain('path-b@example.com');
  });

  it('path A + path B with overlapping email — first-seen wins (path A precedes path B)', () => {
    // Same email appears in a player's parentContact (path A) AND as a registered user (path B)
    const sharedEmail = 'shared@example.com';
    const player = makePlayer({
      email: undefined,
      parentContact: { parentName: 'Path A Parent', parentEmail: sharedEmail, uid: 'uid-a' },
    });
    const teams = new Map<string, RawTeamData>([[TEAM_ID, { name: 'Lions' }]]);
    const playerMap = new Map<string, RawPlayerData[]>([[TEAM_ID, [player]]]);

    const parentUsers: RawParentUserData[] = [
      makeParentUser({ uid: 'uid-b', email: sharedEmail, displayName: 'Path B Parent' }),
    ];

    const result = computeEventRecipients([TEAM_ID], playerMap, new Map(), teams, parentUsers);

    // Only one entry — path A wins (processed before path B)
    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe('uid-a');
    expect(result[0].type).toBe('parent');
  });

  it('coach who is also a registered parent user — not double-counted', () => {
    // A user is both a coach on the team AND a registered parent
    const sharedEmail = 'coach-parent@example.com';
    const teams = new Map<string, RawTeamData>([[TEAM_ID, makeTeam()]]);
    const coaches = new Map<string, RawUserData>([
      [COACH_UID, { email: sharedEmail, displayName: 'Coach-Parent' }],
    ]);
    const parentUsers: RawParentUserData[] = [
      makeParentUser({ uid: COACH_UID, email: sharedEmail }),
    ];

    const result = computeEventRecipients([TEAM_ID], new Map(), coaches, teams, parentUsers);

    // Coach entry processed first — path B deduped out
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('coach');
    expect(result[0].email).toBe(sharedEmail);
  });

  it('parent user without email is silently skipped', () => {
    const teams = new Map<string, RawTeamData>([[TEAM_ID, { name: 'Lions' }]]);
    const parentUsers: RawParentUserData[] = [
      makeParentUser({ email: undefined }),
    ];

    const result = computeEventRecipients([TEAM_ID], new Map(), new Map(), teams, parentUsers);

    expect(result).toHaveLength(0);
  });

  it('falls back to email as name when displayName absent for path B parent', () => {
    const teams = new Map<string, RawTeamData>([[TEAM_ID, { name: 'Lions' }]]);
    const parentUsers: RawParentUserData[] = [
      makeParentUser({ displayName: undefined, email: 'noname@example.com' }),
    ];

    const result = computeEventRecipients([TEAM_ID], new Map(), new Map(), teams, parentUsers);

    expect(result[0].name).toBe('noname@example.com');
  });

  it('backward-compat: omitting parentUsers param returns same result as empty array', () => {
    const teams = new Map<string, RawTeamData>([[TEAM_ID, makeTeam()]]);
    const coaches = new Map<string, RawUserData>([[COACH_UID, makeCoachProfile()]]);

    const withParam = computeEventRecipients([TEAM_ID], new Map(), coaches, teams, []);
    const withoutParam = computeEventRecipients([TEAM_ID], new Map(), coaches, teams);

    expect(withParam).toEqual(withoutParam);
  });
});
