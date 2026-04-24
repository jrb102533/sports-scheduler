// Migrate wizardDraft from league-level to season-scoped path (FW-54).
//
// Old path: leagues/{leagueId}/wizardDraft/draft
// New path: leagues/{leagueId}/seasons/{seasonId}/wizardDraft/draft
//
// Strategy: for each league with a league-level draft, find the league's most
// recently created season and copy the draft there. If no season exists, the
// draft is skipped (it cannot be migrated without a season to scope it to).
//
// Run from project root:
//   GOOGLE_APPLICATION_CREDENTIALS=~/.config/firebase/jrboyd33_gmail_com_application_default_credentials.json \
//     node scripts/migrate-wizard-draft.mjs
//
// Safe to re-run: a league whose season-scoped path already has a draft is skipped.
// The old league-level doc is deleted after a successful copy.

import admin from './functions/node_modules/firebase-admin/lib/index.js';

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

async function main() {
  const leaguesSnap = await db.collection('leagues').get();
  console.log(`Scanning ${leaguesSnap.size} league(s) for league-level wizard drafts…`);

  let migrated = 0;
  let skippedNoSeason = 0;
  let skippedAlreadyMigrated = 0;
  let skippedNoDraft = 0;

  for (const leagueDoc of leaguesSnap.docs) {
    const leagueId = leagueDoc.id;

    const draftRef = db.doc(`leagues/${leagueId}/wizardDraft/draft`);
    const draftSnap = await draftRef.get();

    if (!draftSnap.exists) {
      skippedNoDraft++;
      continue;
    }

    const draftData = draftSnap.data();

    // Find the league's seasons, pick the most recently created one.
    const seasonsSnap = await db
      .collection(`leagues/${leagueId}/seasons`)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (seasonsSnap.empty) {
      console.warn(`  [SKIP] leagues/${leagueId} — has a draft but no seasons; cannot migrate.`);
      skippedNoSeason++;
      continue;
    }

    const seasonId = seasonsSnap.docs[0].id;
    const targetRef = db.doc(`leagues/${leagueId}/seasons/${seasonId}/wizardDraft/draft`);
    const targetSnap = await targetRef.get();

    if (targetSnap.exists) {
      console.log(`  [SKIP] leagues/${leagueId}/seasons/${seasonId} — season-scoped draft already exists.`);
      skippedAlreadyMigrated++;
      continue;
    }

    await targetRef.set({ ...draftData, seasonId });
    await draftRef.delete();

    console.log(`  [OK]   leagues/${leagueId} → seasons/${seasonId}/wizardDraft/draft`);
    migrated++;
  }

  console.log(`\nDone. migrated=${migrated} skipped_no_draft=${skippedNoDraft} skipped_no_season=${skippedNoSeason} skipped_already_migrated=${skippedAlreadyMigrated}`);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
