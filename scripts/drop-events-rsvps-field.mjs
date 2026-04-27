#!/usr/bin/env node
/**
 * drop-events-rsvps-field.mjs — FW-95 cleanup
 *
 * Removes the legacy `rsvps` array field from all event documents in Firestore.
 * All RSVP data is now stored exclusively in the events/{id}/rsvps/{docKey}
 * subcollection (migrated in FW-90b). The top-level array field is unused and
 * safe to drop.
 *
 * Idempotent — safe to run multiple times. Docs that already have no `rsvps`
 * field are skipped without a write.
 *
 * Run AFTER both FW-90b and FW-97 are deployed and the migration script
 * (migrate-rsvps-to-subcollection.mjs) has completed successfully.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/<service-account-key>.json \
 *   node scripts/drop-events-rsvps-field.mjs [--dry-run] [--project staging|production]
 *
 * Options:
 *   --dry-run     Log what would be written without touching Firestore.
 *   --project     Informational only — set GOOGLE_APPLICATION_CREDENTIALS for
 *                 the target project; this script does not use the flag directly.
 *
 * Cost estimate (one-time run):
 *   R: 1 read per event doc (full collection scan — no filter for "has rsvps field"
 *      since Firestore has no "field exists" filter for array fields).
 *   W: 1 update per doc that has the rsvps field (removes the field).
 *   Bounded batch writes: max 500 per batch.
 *   Typical: hundreds of events — cost is negligible.
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ─── Init ─────────────────────────────────────────────────────────────────────

if (!getApps().length) initializeApp();
const db = getFirestore();

const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) console.log('[drop-rsvps-field] DRY RUN — no writes will occur');

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 500; // Firestore max writes per batch

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[drop-rsvps-field] scanning all events for legacy rsvps[] field...');

  const eventsSnap = await db.collection('events').get();

  let totalDocs = 0;
  let docsWithField = 0;
  let docsDropped = 0;
  let docsSkipped = 0;
  let errors = 0;

  // Collect docs that need the field removed.
  const toUpdate = [];
  for (const evDoc of eventsSnap.docs) {
    totalDocs++;
    const data = evDoc.data();

    if (!Object.prototype.hasOwnProperty.call(data, 'rsvps')) {
      docsSkipped++;
      continue;
    }

    docsWithField++;
    const arrayLen = Array.isArray(data.rsvps) ? data.rsvps.length : '(non-array)';
    console.log(`  [will drop] events/${evDoc.id} — rsvps field present (${arrayLen} entries)`);
    toUpdate.push(evDoc.ref);
  }

  console.log(`\n[drop-rsvps-field] found ${docsWithField} docs with rsvps field; ${docsSkipped} already clean`);

  if (toUpdate.length === 0) {
    console.log('[drop-rsvps-field] nothing to do — all event docs already clean.');
    return;
  }

  if (DRY_RUN) {
    console.log(`[drop-rsvps-field] DRY RUN — would update ${toUpdate.length} docs`);
    return;
  }

  // Write in bounded batches (max 500 per batch).
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const ref of chunk) {
      batch.update(ref, { rsvps: FieldValue.delete() });
    }

    try {
      await batch.commit();
      docsDropped += chunk.length;
      console.log(`  [batch committed] ${i + chunk.length}/${toUpdate.length} docs updated`);
    } catch (err) {
      console.error(`  [error] batch commit failed for chunk starting at index ${i}: ${err.message}`);
      errors += chunk.length;
    }
  }

  console.log('\n[drop-rsvps-field] done.');
  console.log(`  Total event docs scanned:      ${totalDocs}`);
  console.log(`  Docs with rsvps field:         ${docsWithField}`);
  console.log(`  Docs already clean (skipped):  ${docsSkipped}`);
  console.log(`  Docs updated (field dropped):  ${docsDropped}`);
  console.log(`  Errors:                        ${errors}`);

  if (errors > 0) {
    console.error('\n[drop-rsvps-field] completed with errors — review logs above and re-run to retry.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[drop-rsvps-field] fatal error:', err);
  process.exit(1);
});
