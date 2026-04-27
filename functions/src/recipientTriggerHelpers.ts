/**
 * recipientTriggerHelpers.ts — Firestore-aware rebuild helper for FW-82 recipient triggers
 *
 * Shared by:
 *   - onTeamMembershipChanged trigger (FW-84)
 *   - onPlayerWritten trigger         (FW-88)
 *
 * Extracted from the inline body of onTeamMembershipChanged so the same rebuild
 * logic is never duplicated. computeEventRecipients (pure, no Firestore) lives
 * in recipientHelpers.ts to keep that module independently testable.
 *
 * See ADR-012 (cost-discipline architecture) and FW-82.
 */

import * as admin from 'firebase-admin';
import { computeEventRecipients } from './recipientHelpers';

/** Max values per Firestore `in` query clause (Firestore limit is 30). */
const IN_QUERY_LIMIT = 30;

/** Firestore batch write limit. */
const BATCH_LIMIT = 500;

/**
 * Rebuild event.recipients[] for every upcoming scheduled event that involves
 * `teamId`. Scoped to status=scheduled and date>=today to avoid unbounded scans.
 *
 * Cost profile: reads are bounded by (events × teams-per-event × coaches+players).
 * Acceptable for a per-write trigger — see FW-88 design for the accepted
 * redundant-rebuild trade-off on bulk roster ops (FW-89 deferred debounce).
 *
 * @param teamId  The team whose upcoming events need recipients refreshed.
 * @param db      Firestore instance (admin.firestore()).
 */
export async function rebuildRecipientsForTeam(
  teamId: string,
  db: admin.firestore.Firestore,
): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10);

  // Query upcoming scheduled events for this team — bounded by date + status.
  const eventsSnap = await db
    .collection('events')
    .where('teamIds', 'array-contains', teamId)
    .where('status', '==', 'scheduled')
    .where('date', '>=', todayStr)
    .get();

  if (eventsSnap.empty) {
    return; // No upcoming events — nothing to do.
  }

  // Collect all distinct teamIds across matched events (game events carry both
  // home and away team IDs).
  const allTeamIds = new Set<string>([teamId]);
  for (const evDoc of eventsSnap.docs) {
    const teamIds: unknown[] = (evDoc.data().teamIds as unknown[]) ?? [];
    for (const id of teamIds) {
      if (typeof id === 'string' && id.length > 0) allTeamIds.add(id);
    }
  }

  const teamIdList = Array.from(allTeamIds);

  // Batch-read team documents.
  const teamDataById = new Map<string, FirebaseFirestore.DocumentData>();
  for (let i = 0; i < teamIdList.length; i += IN_QUERY_LIMIT) {
    const chunk = teamIdList.slice(i, i + IN_QUERY_LIMIT);
    const snap = await db
      .collection('teams')
      .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
      .get();
    for (const doc of snap.docs) teamDataById.set(doc.id, doc.data());
  }

  // Collect coach UIDs from all team documents.
  const allCoachIds = new Set<string>();
  for (const teamData of teamDataById.values()) {
    for (const uid of (teamData.coachIds as string[] | undefined) ?? []) {
      if (typeof uid === 'string' && uid.length > 0) allCoachIds.add(uid);
    }
  }

  // Batch-read coach user profiles.
  const coachProfiles = new Map<string, FirebaseFirestore.DocumentData>();
  const coachIdList = Array.from(allCoachIds);
  for (let i = 0; i < coachIdList.length; i += IN_QUERY_LIMIT) {
    const chunk = coachIdList.slice(i, i + IN_QUERY_LIMIT);
    const snap = await db
      .collection('users')
      .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
      .get();
    for (const doc of snap.docs) coachProfiles.set(doc.id, doc.data());
  }

  // Batch-read players for all involved teams.
  const playersByTeam = new Map<string, FirebaseFirestore.DocumentData[]>();
  for (const id of allTeamIds) playersByTeam.set(id, []);
  for (let i = 0; i < teamIdList.length; i += IN_QUERY_LIMIT) {
    const chunk = teamIdList.slice(i, i + IN_QUERY_LIMIT);
    const snap = await db
      .collection('players')
      .where('teamId', 'in', chunk)
      .get();
    for (const doc of snap.docs) {
      const tid = doc.data().teamId as string | undefined;
      if (!tid) continue;
      const bucket = playersByTeam.get(tid) ?? [];
      bucket.push(doc.data());
      playersByTeam.set(tid, bucket);
    }
  }

  // Batch-write recipients onto each event (Firestore batch limit = 500).
  let batchObj = db.batch();
  let batchCount = 0;

  for (const evDoc of eventsSnap.docs) {
    const eventTeamIds: string[] = ((evDoc.data().teamIds as unknown[]) ?? []).filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    const recipients = computeEventRecipients(
      eventTeamIds,
      playersByTeam as Map<string, Record<string, unknown>[]>,
      coachProfiles as Map<string, Record<string, unknown>>,
      teamDataById as Map<string, Record<string, unknown>>,
    );
    batchObj.update(evDoc.ref, { recipients });
    batchCount++;

    if (batchCount >= BATCH_LIMIT) {
      await batchObj.commit();
      batchObj = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) await batchObj.commit();
}
