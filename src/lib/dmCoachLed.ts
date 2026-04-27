/**
 * Coach-led DM permission helpers.
 *
 * Rule (product): parents/players may DM coaches; coaches may DM anyone on
 * a team they coach; parents/players may NOT DM each other. Existing legacy
 * parent-to-parent threads are filtered out of the UI silently — data is
 * preserved at the rules layer for audit, but we don't surface them.
 *
 * These helpers are pure functions consumed by DmPanel and unit-tested in
 * isolation. The Firestore-rules counterpart (SEC-71) enforces the same
 * shape server-side via teamId on dmThreads/{id}.
 */
import type { Team, Player, DmThread } from '@/types';

/** Returns true if uid is a coach (or admin) of any team in the list. */
export function isCoachOfAnyTeam(uid: string, teams: Team[]): boolean {
  return teams.some(t => t.coachId === uid || t.coachIds?.includes(uid));
}

/**
 * Returns the teamId that grounds a DM between two uids — i.e. a team
 * where at least one participant is a coach AND both participants are
 * affiliated with that team (coach, member, or linked parent of a player
 * on the team). Returns null if no such team exists, in which case the
 * DM is not allowed under the coach-led rule.
 */
export function findCoachLedTeamId(
  uidA: string,
  uidB: string,
  teams: Team[],
  players: Player[],
): string | null {
  // Score each candidate team and return the strongest match. Affiliation
  // strength per uid: coach=3, parent-of-player=2, linked-player=1, none=0.
  // FW-105: when a coach manages multiple teams both containing the other
  // participant, picking the first iterated team produced an arbitrary
  // audit-trail teamId. Scoring prefers the team where both participants
  // are most directly affiliated. Ties broken by iteration order.
  let best: { teamId: string; score: number } | null = null;

  for (const t of teams) {
    const coaches = new Set<string>();
    if (t.coachId) coaches.add(t.coachId);
    t.coachIds?.forEach(id => coaches.add(id));

    if (!coaches.has(uidA) && !coaches.has(uidB)) continue;

    const teamParents = new Set<string>(
      players.filter(p => p.teamId === t.id && p.parentUid).map(p => p.parentUid!),
    );
    const teamLinked = new Set<string>(
      players.filter(p => p.teamId === t.id && p.linkedUid).map(p => p.linkedUid!),
    );
    const affiliationScore = (uid: string): number => {
      if (coaches.has(uid)) return 3;
      if (teamParents.has(uid)) return 2;
      if (teamLinked.has(uid)) return 1;
      return 0;
    };

    const scoreA = affiliationScore(uidA);
    const scoreB = affiliationScore(uidB);
    if (scoreA === 0 || scoreB === 0) continue;

    const score = scoreA + scoreB;
    if (!best || score > best.score) {
      best = { teamId: t.id, score };
    }
  }

  return best?.teamId ?? null;
}

/**
 * Returns true if a DM between myUid and otherUid is allowed under the
 * coach-led rule. Equivalent to findCoachLedTeamId(...) !== null.
 */
export function isCoachLedDmAllowed(
  myUid: string,
  otherUid: string,
  teams: Team[],
  players: Player[],
): boolean {
  return findCoachLedTeamId(myUid, otherUid, teams, players) !== null;
}

/**
 * Filter a thread list down to those allowed under coach-led rules. Used
 * to hide legacy parent-to-parent threads from the UI without deleting them.
 */
export function filterCoachLedThreads(
  threads: DmThread[],
  myUid: string,
  teams: Team[],
  players: Player[],
): DmThread[] {
  return threads.filter(t => {
    const otherUid = t.participants.find(uid => uid !== myUid);
    if (!otherUid) return false;
    return isCoachLedDmAllowed(myUid, otherUid, teams, players);
  });
}

/**
 * Filter a contact list (UIDs) for the new-DM picker:
 * - if I'm a coach: anyone on a team I coach
 * - if I'm a parent/player: only coaches of teams I'm affiliated with
 */
export function filterCoachLedContacts(
  contactUids: string[],
  myUid: string,
  teams: Team[],
  players: Player[],
): string[] {
  return contactUids.filter(uid =>
    uid !== myUid && isCoachLedDmAllowed(myUid, uid, teams, players),
  );
}
