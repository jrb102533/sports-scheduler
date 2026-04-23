/**
 * Playwright global teardown — deletes all Firestore documents tagged
 * `isE2eData: true` after all tests complete.
 *
 * Covers:
 *   - Top-level collections: teams, leagues, events, venues
 *   - League subcollections: seasons, divisions, availabilityCollections, venues, wizardDraft
 *   - Team subcollections: players, availability
 *   - User subcollections: consents (seeded by global-setup for all 5 E2E roles)
 *
 * Subcollections are deleted before their parent documents because Firestore
 * does NOT cascade-delete subcollections when a parent document is deleted.
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS to be set (same as global-setup.ts).
 * If not set, teardown logs a warning and exits cleanly — no data is deleted.
 *
 * All deletes are issued as batched writes (max 500 ops per batch) to respect
 * the Firestore batch limit.
 *
 * IMPORTANT: teardown failures are rethrown after logging so that CI marks the
 * run failed. Orphaned staging data is a real problem — silent failure masks it.
 */

import { fileURLToPath } from 'url';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, WriteBatch } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

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
 * Deletes all documents in the named subcollection for each parent document
 * in the provided parent snapshot. No `isE2eData` filter is applied to
 * subcollection docs — any doc under an E2E parent is considered E2E data.
 */
async function deleteSubcollectionForParents(
  db: ReturnType<typeof getFirestore>,
  parentDocs: FirebaseFirestore.QueryDocumentSnapshot[],
  subcollectionName: string,
): Promise<number> {
  let total = 0;
  for (const parentDoc of parentDocs) {
    const snap = await parentDoc.ref.collection(subcollectionName).get();
    if (!snap.empty) {
      await batchDeleteDocs(db, snap.docs);
      total += snap.docs.length;
    }
  }
  return total;
}

/**
 * Deletes all E2E league subcollections (seasons, divisions,
 * availabilityCollections, venues, wizardDraft) before the league parent docs.
 * Returns the total subcollection document count deleted.
 */
async function deleteLeagueSubcollections(
  db: ReturnType<typeof getFirestore>,
): Promise<number> {
  const leaguesSnap = await db.collection('leagues').where('isE2eData', '==', true).get();
  if (leaguesSnap.empty) return 0;

  const LEAGUE_SUBCOLLECTIONS = [
    'seasons',
    'divisions',
    'availabilityCollections',
    'venues',
    'wizardDraft',
  ] as const;

  let total = 0;
  for (const subcol of LEAGUE_SUBCOLLECTIONS) {
    const count = await deleteSubcollectionForParents(db, leaguesSnap.docs, subcol);
    if (count > 0) {
      console.log(`[global-teardown] Deleted ${count} doc(s) from leagues/{id}/${subcol}`);
    }
    total += count;
  }
  return total;
}

/**
 * Deletes all E2E team subcollections (players, availability) before the team
 * parent docs. Returns the total subcollection document count deleted.
 */
async function deleteTeamSubcollections(
  db: ReturnType<typeof getFirestore>,
): Promise<number> {
  const teamsSnap = await db.collection('teams').where('isE2eData', '==', true).get();
  if (teamsSnap.empty) return 0;

  const TEAM_SUBCOLLECTIONS = ['players', 'availability'] as const;

  let total = 0;
  for (const subcol of TEAM_SUBCOLLECTIONS) {
    const count = await deleteSubcollectionForParents(db, teamsSnap.docs, subcol);
    if (count > 0) {
      console.log(`[global-teardown] Deleted ${count} doc(s) from teams/{id}/${subcol}`);
    }
    total += count;
  }
  return total;
}

/**
 * Deletes users/{uid}/consents subcollection docs for all E2E role accounts.
 * These consent docs are seeded by global-setup but carry no `isE2eData` flag
 * (they mirror exactly what a real user consent doc looks like). We identify
 * the UIDs via the same env vars used in global-setup.
 */
async function deleteE2eUserConsents(
  db: ReturnType<typeof getFirestore>,
): Promise<number> {
  const E2E_EMAIL_VARS = [
    'E2E_ADMIN_EMAIL',
    'E2E_COACH_EMAIL',
    'E2E_PARENT_EMAIL',
    'E2E_PLAYER_EMAIL',
    'E2E_LM_EMAIL',
  ] as const;

  const authAdmin = getAuth();
  let total = 0;

  for (const envVar of E2E_EMAIL_VARS) {
    const rawEmail = process.env[envVar];
    if (!rawEmail) continue;

    const email = rawEmail.trim().toLowerCase();
    try {
      const userRecord = await authAdmin.getUserByEmail(email);
      const consentsSnap = await db
        .collection('users')
        .doc(userRecord.uid)
        .collection('consents')
        .get();

      if (!consentsSnap.empty) {
        await batchDeleteDocs(db, consentsSnap.docs);
        total += consentsSnap.docs.length;
        console.log(
          `[global-teardown] Deleted ${consentsSnap.docs.length} consent doc(s) for ${email} (${userRecord.uid})`,
        );
      }
    } catch (err) {
      // Non-fatal per account — log and continue so remaining accounts are cleaned.
      // A missing account in Auth is the most common cause and is harmless.
      console.warn(
        `[global-teardown] Could not delete consents for ${email} (${envVar}) —`,
        err,
      );
    }
  }

  return total;
}

// ---------------------------------------------------------------------------
// Teardown entry point
// ---------------------------------------------------------------------------

async function globalTeardown(): Promise<void> {
  // Emulator tier has ephemeral state — nothing to clean up in staging Firestore.
  if (process.env.E2E_TIER === 'emulator') {
    return;
  }

  const db = initAdmin();
  if (!db) return;

  console.log('[global-teardown] Cleaning up E2E seed data...');

  try {
    // ── 1. League subcollections (must precede league parent deletes) ────────
    await deleteLeagueSubcollections(db);

    // ── 2. Team subcollections (must precede team parent deletes) ────────────
    await deleteTeamSubcollections(db);

    // ── 3. Top-level E2E documents ───────────────────────────────────────────
    const collections = ['teams', 'leagues', 'events', 'venues'] as const;
    for (const col of collections) {
      const count = await deleteE2eDocsInCollection(db, col);
      if (count > 0) console.log(`[global-teardown] Deleted ${count} E2E doc(s) from ${col}`);
    }

    // ── 4. User consent subcollections ───────────────────────────────────────
    const consentCount = await deleteE2eUserConsents(db);
    if (consentCount > 0) {
      console.log(`[global-teardown] Deleted ${consentCount} total consent doc(s)`);
    }

    console.log('[global-teardown] E2E cleanup complete.');
  } catch (err) {
    // Log first so the error appears in the test report output, then rethrow so
    // CI marks the run failed. Silent teardown failure means orphaned staging
    // data accumulates with no signal — that is worse than a failed run.
    console.error('[global-teardown] Error during E2E data cleanup —', err);
    throw err;
  }
}

export default globalTeardown;
