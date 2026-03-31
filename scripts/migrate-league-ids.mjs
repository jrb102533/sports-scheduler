// Migrate team.leagueId (string) → team.leagueIds (string[])
//
// Run from project root:
//   GOOGLE_APPLICATION_CREDENTIALS=~/.config/firebase/jrboyd33_gmail_com_application_default_credentials.json \
//     node scripts/migrate-league-ids.mjs
//
// Safe to re-run: teams that already have leagueIds are skipped.
// The legacy leagueId field is deleted after migration.

import admin from './functions/node_modules/firebase-admin/lib/index.js';

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

async function main() {
  const snap = await db.collection('teams').get();
  const toMigrate = snap.docs.filter(d => {
    const data = d.data();
    return typeof data.leagueId === 'string' && data.leagueId.length > 0;
  });

  console.log(`Found ${toMigrate.length} team(s) with a legacy leagueId field.`);

  if (toMigrate.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  const BATCH_SIZE = 400; // Firestore batch limit is 500 ops; 2 ops per doc
  for (let i = 0; i < toMigrate.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const slice = toMigrate.slice(i, i + BATCH_SIZE);
    for (const docSnap of slice) {
      const { leagueId } = docSnap.data();
      batch.update(docSnap.ref, {
        leagueIds: admin.firestore.FieldValue.arrayUnion(leagueId),
        leagueId: admin.firestore.FieldValue.delete(),
      });
    }
    await batch.commit();
    console.log(`Migrated batch ${Math.floor(i / BATCH_SIZE) + 1}: ${slice.length} team(s).`);
  }

  console.log('Migration complete.');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
