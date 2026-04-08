/**
 * One-time migration: move parentContact, parentContact2, dateOfBirth, emergencyContact
 * from the main player document to the players/{id}/sensitiveData/private subcollection.
 *
 * Safe to run multiple times — idempotent (existing subcollection docs are merged, not overwritten).
 *
 * Usage (from functions/ directory):
 *   node scripts/migrate-sensitive-player-data.js [--dry-run]
 */

const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.resolve(__dirname, '../service-account.json');
try {
  const sa = require(serviceAccountPath);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
} catch {
  admin.initializeApp();
}

const db = admin.firestore();
const DRY_RUN = process.argv.includes('--dry-run');
const SENSITIVE_KEYS = ['dateOfBirth', 'parentContact', 'parentContact2', 'emergencyContact'];

async function main() {
  console.log(DRY_RUN ? '--- DRY RUN ---' : '--- LIVE RUN ---');

  const playersSnap = await db.collection('players').get();
  console.log(`Found ${playersSnap.size} total player documents.`);

  let migrated = 0;
  let skipped = 0;
  let batch = db.batch();
  let batchOps = 0;

  for (const playerDoc of playersSnap.docs) {
    const data = playerDoc.data();
    const sensitiveFields = {};

    for (const key of SENSITIVE_KEYS) {
      if (data[key] !== undefined) {
        sensitiveFields[key] = data[key];
      }
    }

    if (Object.keys(sensitiveFields).length === 0) {
      skipped++;
      continue;
    }

    const name = `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim() || playerDoc.id;
    console.log(`  Migrating: ${name} — fields: ${Object.keys(sensitiveFields).join(', ')}`);

    if (!DRY_RUN) {
      const sensitiveRef = db.doc(`players/${playerDoc.id}/sensitiveData/private`);
      batch.set(sensitiveRef,
        { playerId: playerDoc.id, teamId: data.teamId ?? '', ...sensitiveFields },
        { merge: true }
      );

      const stripped = {};
      for (const key of Object.keys(sensitiveFields)) {
        stripped[key] = admin.firestore.FieldValue.delete();
      }
      batch.update(playerDoc.ref, stripped);

      batchOps += 2;
      if (batchOps >= 400) {
        await batch.commit();
        batch = db.batch();
        batchOps = 0;
      }
    }

    migrated++;
  }

  if (!DRY_RUN && batchOps > 0) {
    await batch.commit();
  }

  console.log(`\nDone. Migrated: ${migrated}, Skipped (no sensitive data on main doc): ${skipped}`);
  if (DRY_RUN) {
    console.log('Re-run without --dry-run to apply changes.');
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
