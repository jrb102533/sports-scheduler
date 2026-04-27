#!/usr/bin/env node
/**
 * backfill-rsvp-counts.mjs — FW-98
 *
 * Walks all event documents and computes rsvpCounts from each event's
 * events/{id}/rsvps subcollection, then writes the result onto the event doc.
 *
 * Idempotent: running twice overwrites with the same data.
 *
 * Deploy ordering note:
 *   Run AFTER deploying the onRsvpWritten trigger so new writes are covered
 *   going forward. This script back-fills existing events that were written
 *   before the trigger existed.
 *
 * Run from the repo root:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/<key>.json \
 *   node scripts/backfill-rsvp-counts.mjs [--dry-run]
 *
 * Options:
 *   --dry-run   Log what would be written without touching Firestore.
 *
 * Cost estimate (first run):
 *   R: 1 events query (all docs) + 1 rsvps subcollection read per event
 *   W: 1 per event with RSVPs, plus 1 per event without (to stamp zeros)
 *   Both R and W are batched up to 500 ops per batch.
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ─── Init ─────────────────────────────────────────────────────────────────────

if (!getApps().length) initializeApp();
const db = getFirestore();

const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) console.log('[backfill-rsvp-counts] DRY RUN — no writes will occur');

const BATCH_SIZE = 500;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[backfill-rsvp-counts] Reading all event documents…');
  const eventsSnap = await db.collection('events').get();
  console.log(`[backfill-rsvp-counts] Found ${eventsSnap.size} events`);

  let processed = 0;
  let skipped = 0;
  let writeCount = 0;

  let batch = db.batch();
  let batchOps = 0;

  async function flushBatch() {
    if (batchOps === 0) return;
    if (!DRY_RUN) await batch.commit();
    writeCount += batchOps;
    batch = db.batch();
    batchOps = 0;
  }

  for (const eventDoc of eventsSnap.docs) {
    const eventId = eventDoc.id;

    // Read the rsvps subcollection for this event.
    const rsvpsSnap = await db.collection(`events/${eventId}/rsvps`).get();

    const counts = { yes: 0, no: 0, maybe: 0 };
    for (const rsvpDoc of rsvpsSnap.docs) {
      const r = rsvpDoc.data()['response'];
      if (r === 'yes' || r === 'no' || r === 'maybe') {
        counts[r]++;
      }
    }

    const existing = eventDoc.data()['rsvpCounts'];
    if (
      existing &&
      existing.yes === counts.yes &&
      existing.no === counts.no &&
      existing.maybe === counts.maybe
    ) {
      skipped++;
      console.log(`[backfill-rsvp-counts] SKIP  event=${eventId} (counts unchanged: yes=${counts.yes} no=${counts.no} maybe=${counts.maybe})`);
      continue;
    }

    console.log(
      `[backfill-rsvp-counts] ${DRY_RUN ? 'WOULD WRITE' : 'WRITE'} event=${eventId}` +
      ` yes=${counts.yes} no=${counts.no} maybe=${counts.maybe}` +
      ` (${rsvpsSnap.size} rsvp docs)`
    );

    if (!DRY_RUN) {
      batch.update(eventDoc.ref, { rsvpCounts: counts });
      batchOps++;
      if (batchOps >= BATCH_SIZE) await flushBatch();
    }

    processed++;
  }

  await flushBatch();

  console.log('[backfill-rsvp-counts] Done.');
  console.log(`  Events processed : ${processed}`);
  console.log(`  Events skipped   : ${skipped} (already up-to-date)`);
  console.log(`  Firestore writes : ${writeCount}`);
}

main().catch(err => {
  console.error('[backfill-rsvp-counts] Fatal error:', err);
  process.exit(1);
});
