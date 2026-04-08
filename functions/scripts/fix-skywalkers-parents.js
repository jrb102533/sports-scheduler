/**
 * One-time migration: link bare parent accounts to the Skywalkers team.
 *
 * "Bare" = role === 'parent', no teamId, no memberships array.
 * These were created by the onAuthStateChanged race condition before the
 * verifyInvitedUser fix was deployed.
 *
 * Usage (from functions/ directory):
 *   node scripts/fix-skywalkers-parents.js [--dry-run]
 */

const admin = require('firebase-admin');
const path = require('path');

// Point at production service account key if present, otherwise use ADC
const serviceAccountPath = path.resolve(__dirname, '../service-account.json');
try {
  const sa = require(serviceAccountPath);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
} catch {
  admin.initializeApp(); // falls back to Application Default Credentials
}

const db = admin.firestore();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(DRY_RUN ? '--- DRY RUN ---' : '--- LIVE RUN ---');

  // 1. Find the Skywalkers team
  const teamsSnap = await db.collection('teams')
    .where('name', '==', 'Skywalkers')
    .limit(1)
    .get();

  if (teamsSnap.empty) {
    // Try case-insensitive by fetching all and filtering (team list is small)
    const allTeams = await db.collection('teams').get();
    const match = allTeams.docs.find(d =>
      (d.data().name ?? '').toLowerCase() === 'skywalkers'
    );
    if (!match) {
      console.error('ERROR: No team named "Skywalkers" found. Check the team name in Firestore.');
      process.exit(1);
    }
    teamsSnap.docs.push(match);
  }

  const teamDoc = teamsSnap.docs[0];
  const teamId = teamDoc.id;
  console.log(`Found team: "${teamDoc.data().name}" (${teamId})`);

  // 2. Find bare parent accounts — role === 'parent', no teamId, no memberships
  const usersSnap = await db.collection('users')
    .where('role', '==', 'parent')
    .get();

  const bare = usersSnap.docs.filter(d => {
    const data = d.data();
    const hasMemberships = Array.isArray(data.memberships) && data.memberships.length > 0;
    const hasTeamId = !!data.teamId;
    return !hasMemberships && !hasTeamId;
  });

  if (bare.length === 0) {
    console.log('No bare parent accounts found — nothing to fix.');
    process.exit(0);
  }

  console.log(`\nFound ${bare.length} bare parent account(s) to patch:`);
  bare.forEach(d => {
    const data = d.data();
    console.log(`  - ${data.displayName ?? data.email ?? d.id} (uid: ${d.id})`);
  });

  if (DRY_RUN) {
    console.log('\nDry run complete. Re-run without --dry-run to apply changes.');
    process.exit(0);
  }

  // 3. Patch each account
  const batch = db.batch();
  const membership = {
    role: 'parent',
    teamId,
    isPrimary: true,
  };

  for (const doc of bare) {
    batch.update(doc.ref, {
      teamId,
      memberships: admin.firestore.FieldValue.arrayUnion(membership),
    });
  }

  await batch.commit();
  console.log(`\nPatched ${bare.length} account(s) successfully.`);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
