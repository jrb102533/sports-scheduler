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
  for (const t of teams) {
    const coaches = new Set<string>();
    if (t.coachId) coaches.add(t.coachId);
    t.coachIds?.forEach(id => coaches.add(id));

    const aIsCoach = coaches.has(uidA);
    const bIsCoach = coaches.has(uidB);
    if (!aIsCoach && !bIsCoach) continue;

    const teamParents = new Set<string>(
      players.filter(p => p.teamId === t.id && p.parentUid).map(p => p.parentUid!),
    );
    const teamLinked = new Set<string>(
      players.filter(p => p.teamId === t.id && p.linkedUid).map(p => p.linkedUid!),
    );
    const onTeam = (uid: string) =>
      coaches.has(uid) || teamParents.has(uid) || teamLinked.has(uid);

    if (onTeam(uidA) && onTeam(uidB)) return t.id;
  }
  return null;
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
