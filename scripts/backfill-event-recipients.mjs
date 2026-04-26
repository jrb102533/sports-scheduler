#!/usr/bin/env node
/**
 * backfill-event-recipients.mjs — Phase A of FW-82 notification architecture
 *
 * Walks all upcoming events (status=scheduled, date >= today) and writes a
 * `recipients[]` array to each event doc. The array is computed using the same
 * logic as the existing reminder CFs: read team → coachIds → user profiles,
 * then players → parent contacts.
 *
 * Idempotent: running twice produces the same result (overwrites with
 * identical data).
 *
 * Run from the repo root:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/<key>.json \
 *   node scripts/backfill-event-recipients.mjs [--dry-run]
 *
 * Options:
 *   --dry-run   Log what would be written without touching Firestore.
 *
 * Cost estimate (first run):
 *   R: 1 events query + N_teams team reads + N_teams player-query reads
 *      + N_coach_uids user profile reads
 *   W: 1 per event (batched, 500/batch max)
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ─── Init ─────────────────────────────────────────────────────────────────────

if (!getApps().length) initializeApp();
const db = getFirestore();

const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) console.log('[backfill] DRY RUN — no writes will occur');

// ─── Firestore constants ──────────────────────────────────────────────────────

const FIRESTORE_IN_LIMIT = 30;
const BATCH_WRITE_LIMIT = 500;

// ─── Recipient computation (inline — mirrors recipientHelpers.ts logic) ───────
// We inline the logic here rather than import from the TS source to avoid a
// compile step in a one-shot admin script. Keep in sync with recipientHelpers.ts.

function computeEventRecipients(teamIds, playersByTeam, coachProfiles, teamDataById) {
  const seen = new Set();
  const recipients = [];

  function addRecipient(r) {
    const key = r.email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    recipients.push(r);
  }

  for (const teamId of teamIds) {
    const teamData = teamDataById.get(teamId);
    const coachIds = teamData?.coachIds ?? [];

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

    const players = playersByTeam.get(teamId) ?? [];
    for (const player of players) {
      const firstName = player.firstName ?? '';
      const lastName = player.lastName ?? '';
      const playerName = `${firstName} ${lastName}`.trim() || 'Player';

      if (player.email) {
        addRecipient({ uid: player.uid, email: player.email, name: playerName, type: 'player' });
      }
      if (player.parentContact?.parentEmail) {
        addRecipient({
          uid: player.parentContact.uid,
          email: player.parentContact.parentEmail,
          name: player.parentContact.parentName ?? `Parent of ${playerName}`,
          type: 'parent',
        });
      }
      if (player.parentContact2?.parentEmail) {
        addRecipient({
          uid: player.parentContact2.uid,
          email: player.parentContact2.parentEmail,
          name: player.parentContact2.parentName ?? `Parent of ${playerName}`,
          type: 'parent',
        });
      }
    }
  }

  return recipients;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function batchFetchByIds(collectionName, ids) {
  const result = new Map();
  const idList = Array.from(ids);
  for (let i = 0; i < idList.length; i += FIRESTORE_IN_LIMIT) {
    const chunk = idList.slice(i, i + FIRESTORE_IN_LIMIT);
    const snap = await db.collection(collectionName)
      .where(getFirestore().FieldPath.documentId(), 'in', chunk)
      .get();
    for (const doc of snap.docs) {
      result.set(doc.id, doc.data());
    }
  }
  return result;
}

async function fetchPlayersByTeams(teamIds) {
  const playersByTeam = new Map();
  for (const id of teamIds) playersByTeam.set(id, []);

  const idList = Array.from(teamIds);
  for (let i = 0; i < idList.length; i += FIRESTORE_IN_LIMIT) {
    const chunk = idList.slice(i, i + FIRESTORE_IN_LIMIT);
    const snap = await db.collection('players').where('teamId', 'in', chunk).get();
    for (const doc of snap.docs) {
      const teamId = doc.data().teamId;
      if (!teamId) continue;
      const bucket = playersByTeam.get(teamId) ?? [];
      bucket.push(doc.data());
      playersByTeam.set(teamId, bucket);
    }
  }
  return playersByTeam;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const todayStr = new Date().toISOString().slice(0, 10);
  console.log(`[backfill] querying upcoming events (date >= ${todayStr}, status=scheduled)…`);

  const eventsSnap = await db
    .collection('events')
    .where('status', '==', 'scheduled')
    .where('date', '>=', todayStr)
    .get();

  if (eventsSnap.empty) {
    console.log('[backfill] no upcoming scheduled events found — nothing to do');
    return;
  }

  console.log(`[backfill] found ${eventsSnap.size} event(s)`);

  // ── 1. Collect all unique teamIds ──────────────────────────────────────────
  const allTeamIds = new Set();
  for (const doc of eventsSnap.docs) {
    const teamIds = doc.data().teamIds ?? [];
    for (const id of teamIds) {
      if (typeof id === 'string' && id.length > 0) allTeamIds.add(id);
    }
  }

  console.log(`[backfill] fetching ${allTeamIds.size} unique team(s)…`);

  // ── 2. Batch-fetch teams ───────────────────────────────────────────────────
  const teamDataById = await batchFetchByIds('teams', allTeamIds);

  // ── 3. Collect unique coachIds ─────────────────────────────────────────────
  const allCoachIds = new Set();
  for (const teamData of teamDataById.values()) {
    for (const uid of teamData.coachIds ?? []) {
      if (typeof uid === 'string' && uid.length > 0) allCoachIds.add(uid);
    }
  }

  console.log(`[backfill] fetching ${allCoachIds.size} coach profile(s)…`);

  // ── 4. Batch-fetch coach profiles (users collection) ──────────────────────
  const coachProfiles = await batchFetchByIds('users', allCoachIds);

  // ── 5. Batch-fetch players by team ─────────────────────────────────────────
  console.log(`[backfill] fetching players for ${allTeamIds.size} team(s)…`);
  const playersByTeam = await fetchPlayersByTeams(allTeamIds);

  // ── 6. Compute recipients + write in batches ───────────────────────────────
  let totalEvents = 0;
  let totalRecipients = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const evDoc of eventsSnap.docs) {
    const teamIds = (evDoc.data().teamIds ?? []).filter(
      (id) => typeof id === 'string' && id.length > 0,
    );

    if (!teamIds.length) {
      console.log(`[backfill] event ${evDoc.id} has no teamIds — skipping`);
      continue;
    }

    const recipients = computeEventRecipients(teamIds, playersByTeam, coachProfiles, teamDataById);

    if (DRY_RUN) {
      console.log(`[backfill][dry-run] event ${evDoc.id}: ${recipients.length} recipient(s)`, recipients.map(r => r.email));
    } else {
      batch.update(evDoc.ref, { recipients });
      batchCount++;

      if (batchCount >= BATCH_WRITE_LIMIT) {
        await batch.commit();
        console.log(`[backfill] committed batch of ${batchCount} writes`);
        batch = db.batch();
        batchCount = 0;
      }
    }

    totalEvents++;
    totalRecipients += recipients.length;
  }

  if (!DRY_RUN && batchCount > 0) {
    await batch.commit();
    console.log(`[backfill] committed final batch of ${batchCount} writes`);
  }

  console.log(
    `[backfill] done — ${totalEvents} event(s) processed, ${totalRecipients} total recipient slot(s)${DRY_RUN ? ' (dry run — nothing written)' : ''}`,
  );
}

main().catch((err) => {
  console.error('[backfill] fatal error:', err);
  process.exit(1);
});
