#!/usr/bin/env node
/**
 * Backfill custom Auth claims for all existing users.
 *
 * Sets { role } as a custom claim on every Firebase Auth account, sourced
 * from the users/{uid} Firestore document. Required after deploying the
 * syncUserClaims CF (PR #524) so existing users don't lose role-gated access
 * while waiting for their next profile write to trigger the CF.
 *
 * Usage (staging):
 *   GOOGLE_APPLICATION_CREDENTIALS=<path-to-service-account.json> \
 *   node scripts/backfill-user-claims.mjs
 *
 * Idempotent: safe to run multiple times. Skips users whose claim already matches.
 * Processes in batches of 50 with a 200ms delay to respect Auth API rate limits.
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

if (!getApps().length) initializeApp();
const db = getFirestore();
const auth = getAuth();

const BATCH_SIZE = 50;
const DELAY_MS = 200;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('Fetching all user documents from Firestore...');
  const snap = await db.collection('users').get();
  const users = snap.docs.map(d => ({ uid: d.id, role: d.data().role ?? null }));
  console.log(`Found ${users.length} users.`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async ({ uid, role }) => {
      try {
        const existing = await auth.getUser(uid);
        const existingRole = existing.customClaims?.role ?? null;
        if (existingRole === role) {
          skipped++;
          return;
        }
        await auth.setCustomUserClaims(uid, { role });
        updated++;
        console.log(`  uid=${uid} role=${role}`);
      } catch (err) {
        // User may exist in Firestore but not Auth (e.g. partially created)
        if (err.code === 'auth/user-not-found') {
          console.warn(`  uid=${uid} not found in Auth — skipping`);
          skipped++;
        } else {
          console.error(`  uid=${uid} FAILED:`, err.message);
          failed++;
        }
      }
    }));

    if (i + BATCH_SIZE < users.length) await sleep(DELAY_MS);
    console.log(`Progress: ${Math.min(i + BATCH_SIZE, users.length)}/${users.length}`);
  }

  console.log(`\nDone. Updated: ${updated}, Skipped (already correct): ${skipped}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
