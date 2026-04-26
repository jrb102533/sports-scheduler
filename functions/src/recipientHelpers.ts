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

// ─── Core helper ─────────────────────────────────────────────────────────────

/**
 * Compute the full recipient list for a single event from pre-fetched data maps.
 *
 * Recipients are deduplicated by email address (case-insensitive). When the
 * same email appears as both a player contact and a parent contact, the first
 * appearance wins (player takes precedence).
 *
 * @param teamIds        The teamIds on the event document.
 * @param playersByTeam  Map of teamId → player docs for those teams.
 * @param coachProfiles  Map of uid → user profile for any coach uid found across the teams.
 * @param teamDataById   Map of teamId → team document data.
 */
export function computeEventRecipients(
  teamIds: string[],
  playersByTeam: Map<string, RawPlayerData[]>,
  coachProfiles: Map<string, RawUserData>,
  teamDataById: Map<string, RawTeamData>,
): EventRecipient[] {
  const seen = new Set<string>(); // deduplicate by lowercased email
  const recipients: EventRecipient[] = [];

  function addRecipient(r: EventRecipient): void {
    const key = r.email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    recipients.push(r);
  }

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

    // ── Players + parents ────────────────────────────────────────────────────
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

      // Primary parent contact
      if (player.parentContact?.parentEmail) {
        const parentName = player.parentContact.parentName ?? `Parent of ${playerName}`;
        addRecipient({
          uid: player.parentContact.uid,
          email: player.parentContact.parentEmail,
          name: parentName,
          type: 'parent',
        });
      }

      // Secondary parent contact
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

  return recipients;
}
