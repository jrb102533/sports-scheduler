#!/usr/bin/env node
/**
 * Audit and fix coaches whose profile memberships are missing a teamId for
 * teams they created via the legacy client-side path (UUID doc IDs).
 *
 * Background: Before createTeamAndBecomeCoach CF was implemented, team docs
 * were created via setDoc from the client. That path set coachId/coachIds on
 * the team doc but never updated profile.memberships. Affected teams have
 * UUID-format doc IDs (e.g. "0c87ba41-3ec7-4ffb-88f4-1e6845d31907") instead
 * of Firestore auto-IDs (e.g. "3klz1PSZKYh2aSeW8uT5").
 *
 * What this script does:
 *   1. Finds all team docs whose `id` field matches UUID format (contains dashes)
 *   2. For each such team, checks the coach's profile.memberships
 *   3. If the coach's memberships don't include the team's ID, reports the gap
 *   4. In fix mode (--fix flag), adds the missing membership entry
 *
 * Idempotent: safe to run multiple times — skips coaches who already have the
 * membership and won't add duplicates.
 *
 * Run from the functions/ directory:
 *   cd functions
 *
 *   # Dry run (report only, no writes):
 *   GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/first-whistle-prod-*.json \
 *   node ../scripts/audit-fix-legacy-team-memberships.mjs
 *
 *   # Apply fixes:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/first-whistle-prod-*.json \
 *   node ../scripts/audit-fix-legacy-team-memberships.mjs --fix
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) initializeApp();
const db = getFirestore();

const FIX_MODE = process.argv.includes('--fix');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

console.log(`\nMode: ${FIX_MODE ? 'FIX (writes enabled)' : 'DRY RUN (no writes)'}\n`);

const teamsSnap = await db.collection('teams').get();
const legacyTeams = teamsSnap.docs.filter(d => UUID_PATTERN.test(d.id));

console.log(`Total teams: ${teamsSnap.size}`);
console.log(`Legacy UUID-format teams: ${legacyTeams.length}\n`);

let gapsFound = 0;
let fixed = 0;
let alreadyOk = 0;

for (const teamDoc of legacyTeams) {
  const team = teamDoc.data();
  const teamId = teamDoc.id;
  const coachUid = team.coachId;

  if (!coachUid) {
    console.log(`  SKIP teams/${teamId} — no coachId field`);
    continue;
  }

  const profileRef = db.doc(`users/${coachUid}`);
  const profileSnap = await profileRef.get();

  if (!profileSnap.exists) {
    console.log(`  SKIP teams/${teamId} — coach ${coachUid} has no profile doc`);
    continue;
  }

  const profile = profileSnap.data();
  const memberships = Array.isArray(profile.memberships) ? profile.memberships : [];
  const alreadyHas = memberships.some(m => m.teamId === teamId);

  if (alreadyHas) {
    console.log(`  OK   teams/${teamId} (${team.name}) — coach ${coachUid} already has membership`);
    alreadyOk++;
    continue;
  }

  gapsFound++;
  console.log(`  GAP  teams/${teamId} (${team.name}) — coach ${coachUid} (${profile.displayName}) missing membership`);
  console.log(`       Current memberships: ${JSON.stringify(memberships)}`);

  if (FIX_MODE) {
    const newMembership = {
      role: 'coach',
      teamId,
      isPrimary: memberships.length === 0,
    };
    await profileRef.update({
      memberships: FieldValue.arrayUnion(newMembership),
    });
    console.log(`       FIXED — added { role: 'coach', teamId: '${teamId}', isPrimary: ${newMembership.isPrimary} }`);
    fixed++;
  }
}

console.log(`\n── Summary ──────────────────────────────────`);
console.log(`  Legacy teams checked : ${legacyTeams.length}`);
console.log(`  Already correct      : ${alreadyOk}`);
console.log(`  Gaps found           : ${gapsFound}`);
if (FIX_MODE) {
  console.log(`  Fixed                : ${fixed}`);
} else if (gapsFound > 0) {
  console.log(`\n  Re-run with --fix to apply repairs.`);
}
console.log();
