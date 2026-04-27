import { describe, it, expect } from 'vitest';
import {
  isCoachOfAnyTeam,
  findCoachLedTeamId,
  isCoachLedDmAllowed,
  filterCoachLedThreads,
  filterCoachLedContacts,
} from './dmCoachLed';
import type { Team, Player, DmThread } from '@/types';

const COACH_A = 'coachA';
const COACH_B = 'coachB';
const PARENT_X = 'parentX';
const PARENT_Y = 'parentY';
const PLAYER_X = 'playerX';

const team1: Team = {
  id: 't1',
  name: 'Hawks',
  sport: 'soccer',
  ageGroup: 'U10',
  coachId: COACH_A,
  coachIds: [COACH_A],
  createdBy: COACH_A,
  createdAt: '',
} as unknown as Team;

const team2: Team = {
  id: 't2',
  name: 'Eagles',
  sport: 'soccer',
  ageGroup: 'U10',
  coachId: COACH_B,
  coachIds: [COACH_B],
  createdBy: COACH_B,
  createdAt: '',
} as unknown as Team;

const players: Player[] = [
  { id: 'p1', teamId: 't1', firstName: 'X', lastName: 'X', parentUid: PARENT_X, linkedUid: PLAYER_X } as unknown as Player,
  { id: 'p2', teamId: 't1', firstName: 'Y', lastName: 'Y', parentUid: PARENT_Y } as unknown as Player,
];

describe('isCoachOfAnyTeam', () => {
  it('true when uid is coachId', () => {
    expect(isCoachOfAnyTeam(COACH_A, [team1, team2])).toBe(true);
  });
  it('true when uid is in coachIds', () => {
    const t: Team = { ...team1, coachId: undefined as unknown as string, coachIds: [COACH_A] };
    expect(isCoachOfAnyTeam(COACH_A, [t])).toBe(true);
  });
  it('false when uid is just a parent', () => {
    expect(isCoachOfAnyTeam(PARENT_X, [team1, team2])).toBe(false);
  });
});

describe('findCoachLedTeamId', () => {
  it('returns teamId when coach + parent share a team', () => {
    expect(findCoachLedTeamId(COACH_A, PARENT_X, [team1, team2], players)).toBe('t1');
  });
  it('returns teamId when coach + linked player share a team', () => {
    expect(findCoachLedTeamId(COACH_A, PLAYER_X, [team1, team2], players)).toBe('t1');
  });
  it('returns null for parent-to-parent on the same team', () => {
    expect(findCoachLedTeamId(PARENT_X, PARENT_Y, [team1, team2], players)).toBeNull();
  });
  it('returns null when no shared team', () => {
    expect(findCoachLedTeamId(COACH_A, 'strangerUid', [team1, team2], players)).toBeNull();
  });
  it('coach-to-coach (different teams) → null unless they share a team', () => {
    expect(findCoachLedTeamId(COACH_A, COACH_B, [team1, team2], players)).toBeNull();
  });
});

describe('isCoachLedDmAllowed', () => {
  it('coach ↔ parent on same team allowed', () => {
    expect(isCoachLedDmAllowed(COACH_A, PARENT_X, [team1, team2], players)).toBe(true);
  });
  it('parent ↔ parent on same team blocked', () => {
    expect(isCoachLedDmAllowed(PARENT_X, PARENT_Y, [team1, team2], players)).toBe(false);
  });
});

describe('filterCoachLedThreads', () => {
  it('hides parent-to-parent threads, keeps coach-led threads', () => {
    const threads: DmThread[] = [
      {
        id: 'cp',
        participants: [COACH_A, PARENT_X],
        participantNames: { [COACH_A]: 'Coach', [PARENT_X]: 'Parent' },
        lastMessage: 'hi',
        lastMessageAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'pp',
        participants: [PARENT_X, PARENT_Y],
        participantNames: { [PARENT_X]: 'A', [PARENT_Y]: 'B' },
        lastMessage: 'old',
        lastMessageAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    const filtered = filterCoachLedThreads(threads, PARENT_X, [team1, team2], players);
    expect(filtered.map(t => t.id)).toEqual(['cp']);
  });
});

describe('filterCoachLedContacts', () => {
  it('parent sees only coaches', () => {
    const contacts = [COACH_A, COACH_B, PARENT_Y, PLAYER_X, PARENT_X];
    const filtered = filterCoachLedContacts(contacts, PARENT_X, [team1, team2], players);
    expect(filtered.sort()).toEqual([COACH_A].sort());
  });
  it('coach sees parents/players on their team', () => {
    const contacts = [PARENT_X, PARENT_Y, PLAYER_X, COACH_B];
    const filtered = filterCoachLedContacts(contacts, COACH_A, [team1, team2], players);
    expect(filtered.sort()).toEqual([PARENT_X, PARENT_Y, PLAYER_X].sort());
  });
  it('excludes self', () => {
    const filtered = filterCoachLedContacts([COACH_A, PARENT_X], COACH_A, [team1, team2], players);
    expect(filtered).not.toContain(COACH_A);
  });
});
