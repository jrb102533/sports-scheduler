#!/usr/bin/env node
/**
 * Backfill isDeleted: false on league docs that don't have the field.
 *
 * Firestore's `!=` operator excludes documents where the field is absent,
 * so leagues created before the isDeleted field was introduced are invisible
 * to the useLeagueStore subscription after PR #524.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=<path-to-service-account.json> \
 *   node scripts/backfill-league-isdeleted.mjs
 *
 * Idempotent — skips docs that already have isDeleted set.
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) initializeApp();
const db = getFirestore();

async function run() {
  const snap = await db.collection('leagues').get();
  console.log(`Found ${snap.docs.length} league(s).`);

  let updated = 0;
  let skipped = 0;

  const writes = snap.docs.map(async (d) => {
    if ('isDeleted' in d.data()) {
      skipped++;
      return;
    }
    await d.ref.update({ isDeleted: false });
    console.log(`  Set isDeleted=false on league ${d.id} (${d.data().name ?? 'unnamed'})`);
    updated++;
  });

  await Promise.all(writes);
  console.log(`\nDone. Updated: ${updated}, Skipped (already had field): ${skipped}`);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
