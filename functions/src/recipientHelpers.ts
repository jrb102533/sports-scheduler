/**
 * recipientHelpers.ts — pure recipient computation for FW-82 notification architecture
 *
 * Shared by:
 *   - backfill-event-recipients.mjs  (Phase A one-shot backfill)
 *   - onEventWritten trigger          (Phase B — keep fresh on event mutation)
 *   - onTeamMembershipChanged trigger (Phase B — keep fresh on roster mutation)
 *   - sendScheduledNotifications CF   (Phase C — consume at send time)
 *
 * The computation is deliberately a pure function that takes pre-fetched data
 * so callers can batch their Firestore reads and reuse maps across many events.
 *
 * See ADR-012 (cost-discipline architecture) and FW-82.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EventRecipient {
  uid?: string;
  email: string;
  name: string;
  type: 'coach' | 'player' | 'parent';
}

/**
 * Raw Firestore shape for a team document (only the fields we care about).
 * Using a narrow interface keeps the helper independent of firebase-admin types.
 */
export interface RawTeamData {
  name?: string;
  coachIds?: string[];
}

/**
 * Raw Firestore shape for a player document.
 */
export interface RawPlayerData {
  uid?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  teamId?: string;
  parentContact?: {
    parentName?: string;
    parentEmail?: string;
    uid?: string;
  };
  parentContact2?: {
    parentName?: string;
    parentEmail?: string;
    uid?: string;
  };
}

/**
 * Raw Firestore shape for a user profile document (users/{uid}).
 * Only the fields needed for coach recipient building.
 */
export interface RawUserData {
  displayName?: string;
  email?: string;
}

/**
 * Raw Firestore shape for a registered parent user (path B identity).
 *
 * Path B: users with top-level `role === 'parent'` and a `memberships[]` array
 * where at least one entry has `{ role: 'parent', teamId: <teamId> }`.
 *
 * These are distinct from path A (embedded player.parentContact), which is
 * empty in prod. Both paths are unioned and deduplicated by email.
 */
export interface RawParentUserData {
  uid: string;
  displayName?: string;
  email?: string;
  memberships?: Array<{ role?: string; teamId?: string; playerId?: string }>;
}

// ─── Core helper ─────────────────────────────────────────────────────────────

/**
 * Compute the full recipient list for a single event from pre-fetched data maps.
 *
 * Recipients are deduplicated by email address (case-insensitive). When the
 * same email appears as both a player contact and a parent contact, the first
 * appearance wins (coaches first, then players/path-A parents, then path-B
 * registered parent users).
 *
 * Two parent identity paths:
 *   Path A — embedded player.parentContact / parentContact2 fields (legacy;
 *             currently empty in prod).
 *   Path B — registered users with role==='parent' and memberships[] entries
 *             that reference the event's teamIds (the live prod path).
 *
 * @param teamIds          The teamIds on the event document.
 * @param playersByTeam    Map of teamId → player docs for those teams.
 * @param coachProfiles    Map of uid → user profile for any coach uid found across the teams.
 * @param teamDataById     Map of teamId → team document data.
 * @param parentUsers      (optional) Registered parent user docs (path B). Pass the
 *                         full list of role==='parent' users pre-fetched by the caller;
 *                         this function filters to those whose memberships[] include the
 *                         event's teamIds. Defaults to [] when omitted (backward-compat).
 *
 * Read cost note: parentUsers is fetched once per CF invocation as a single
 * .where('role','==','parent') query — O(1) reads regardless of event or team
 * count. In-memory filtering then narrows to the relevant teamIds. This is
 * approach (a) from issue #704: acceptable because parent-role users are a
 * small slice of the users collection (prod: ~10s of docs).
 */
export function computeEventRecipients(
  teamIds: string[],
  playersByTeam: Map<string, RawPlayerData[]>,
  coachProfiles: Map<string, RawUserData>,
  teamDataById: Map<string, RawTeamData>,
  parentUsers: RawParentUserData[] = [],
): EventRecipient[] {
  const seen = new Set<string>(); // deduplicate by lowercased email
  const recipients: EventRecipient[] = [];

  function addRecipient(r: EventRecipient): void {
    const key = r.email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    recipients.push(r);
  }

  const teamIdSet = new Set(teamIds);

  for (const teamId of teamIds) {
    const teamData = teamDataById.get(teamId);

    // ── Coaches ──────────────────────────────────────────────────────────────
    const coachIds: string[] = teamData?.coachIds ?? [];
    for (const uid of coachIds) {
      const profile = coachProfiles.get(uid);
      if (!profile?.email) continue;
      addRecipient({
        uid,
        email: profile.email,
        name: profile.displayName ?? profile.email,
        type: 'coach',
      });
    }

    // ── Players + path-A parents ─────────────────────────────────────────────
    const players = playersByTeam.get(teamId) ?? [];
    for (const player of players) {
      const firstName = player.firstName ?? '';
      const lastName = player.lastName ?? '';
      const playerName = `${firstName} ${lastName}`.trim() || 'Player';

      // Player's own email (if they have an account / direct email)
      if (player.email) {
        addRecipient({
          uid: player.uid,
          email: player.email,
          name: playerName,
          type: 'player',
        });
      }

      // Primary parent contact (path A)
      if (player.parentContact?.parentEmail) {
        const parentName = player.parentContact.parentName ?? `Parent of ${playerName}`;
        addRecipient({
          uid: player.parentContact.uid,
          email: player.parentContact.parentEmail,
          name: parentName,
          type: 'parent',
        });
      }

      // Secondary parent contact (path A)
      if (player.parentContact2?.parentEmail) {
        const parent2Name = player.parentContact2.parentName ?? `Parent of ${playerName}`;
        addRecipient({
          uid: player.parentContact2.uid,
          email: player.parentContact2.parentEmail,
          name: parent2Name,
          type: 'parent',
        });
      }
    }
  }

  // ── Path-B: registered parent users ────────────────────────────────────────
  // Filter the pre-fetched parent user list to those whose memberships[] contain
  // at least one entry with role==='parent' AND a teamId that is in this event's
  // teamIds. In-memory filter — no additional Firestore reads here.
  for (const parentUser of parentUsers) {
    if (!parentUser.email) continue;
    const memberships = parentUser.memberships ?? [];
    const matchesTeam = memberships.some(
      (m) => m.role === 'parent' && m.teamId !== undefined && teamIdSet.has(m.teamId),
    );
    if (!matchesTeam) continue;
    addRecipient({
      uid: parentUser.uid,
      email: parentUser.email,
      name: parentUser.displayName ?? parentUser.email,
      type: 'parent',
    });
  }

  return recipients;
}
