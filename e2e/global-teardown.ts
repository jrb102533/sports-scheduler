/**
 * Playwright global teardown — deletes all Firestore documents tagged
 * `isE2eData: true` after all tests complete.
 *
 * Covers:
 *   - Top-level collections: teams, leagues, events, venues
 *   - Subcollection: leagues/{id}/seasons
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS to be set (same as global-setup.ts).
 * If not set, teardown logs a warning and exits cleanly — no data is deleted.
 *
 * All deletes are issued as batched writes (max 500 ops per batch) to respect
 * the Firestore batch limit.
 */

import { fileURLToPath } from 'url';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, WriteBatch } from 'firebase-admin/firestore';

const __filename = fileURLToPath(import.meta.url);
void __filename; // used only to anchor ES module context; actual dirname not needed here

// ---------------------------------------------------------------------------
// Firebase Admin SDK initialisation
// ---------------------------------------------------------------------------

function initAdmin(): ReturnType<typeof getFirestore> | null {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.warn(
      '[global-teardown] GOOGLE_APPLICATION_CREDENTIALS not set — ' +
        'skipping E2E data cleanup. Run manually if staging is in a bad state.',
    );
    return null;
  }

  try {
    if (getApps().length === 0) {
      initializeApp({
        credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      });
    }
    return getFirestore();
  } catch (err) {
    console.error('[global-teardown] Failed to initialise Firebase Admin SDK —', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Batch delete helpers
// ---------------------------------------------------------------------------

const BATCH_LIMIT = 500;

/**
 * Deletes all documents in a snapshot using batched writes.
 * Splits into multiple batches if the snapshot exceeds BATCH_LIMIT.
 */
async function batchDeleteDocs(
  db: ReturnType<typeof getFirestore>,
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<void> {
  if (docs.length === 0) return;

  let batch: WriteBatch = db.batch();
  let opsInBatch = 0;

  for (const doc of docs) {
    batch.delete(doc.ref);
    opsInBatch++;

    if (opsInBatch === BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  if (opsInBatch > 0) {
    await batch.commit();
  }
}

/**
 * Deletes all documents tagged `isE2eData: true` in a top-level collection.
 */
async function deleteE2eDocsInCollection(
  db: ReturnType<typeof getFirestore>,
  collectionName: string,
): Promise<number> {
  const snap = await db.collection(collectionName).where('isE2eData', '==', true).get();
  if (snap.empty) return 0;

  await batchDeleteDocs(db, snap.docs);
  return snap.docs.length;
}

/**
 * Deletes all `isE2eData: true` seasons under every `isE2eData: true` league.
 */
async function deleteE2eSeasons(
  db: ReturnType<typeof getFirestore>,
): Promise<number> {
  const leaguesSnap = await db.collection('leagues').where('isE2eData', '==', true).get();
  if (leaguesSnap.empty) return 0;

  let total = 0;
  for (const leagueDoc of leaguesSnap.docs) {
    const seasonsSnap = await db
      .collection('leagues')
      .doc(leagueDoc.id)
      .collection('seasons')
      .where('isE2eData', '==', true)
      .get();

    if (!seasonsSnap.empty) {
      await batchDeleteDocs(db, seasonsSnap.docs);
      total += seasonsSnap.docs.length;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Teardown entry point
// ---------------------------------------------------------------------------

async function globalTeardown(): Promise<void> {
  const db = initAdmin();
  if (!db) return;

  console.log('[global-teardown] Cleaning up E2E seed data...');

  try {
    // Delete subcollections before their parent documents (Firestore does not
    // cascade-delete subcollections when a parent document is deleted).
    const seasonCount = await deleteE2eSeasons(db);
    if (seasonCount > 0) console.log(`[global-teardown] Deleted ${seasonCount} E2E season(s)`);

    const collections = ['teams', 'leagues', 'events', 'venues'] as const;
    for (const col of collections) {
      const count = await deleteE2eDocsInCollection(db, col);
      if (count > 0) console.log(`[global-teardown] Deleted ${count} E2E doc(s) from ${col}`);
    }

    console.log('[global-teardown] E2E cleanup complete.');
  } catch (err) {
    // Teardown failure should not fail the test run — log and exit cleanly.
    // The next run's idempotency check will reuse or patch the existing data.
    console.error('[global-teardown] Error during E2E data cleanup —', err);
  }
}

export default globalTeardown;
