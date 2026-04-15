#!/usr/bin/env node
/**
 * purge-e2e-data.mjs
 *
 * Deletes only E2E test-generated data from the staging Firestore project.
 * Matches documents by name/title prefix ("E2E ") or email pattern (e2e-*@example.com).
 * Real staging data (coaches, real teams, seeded test data) is NOT touched.
 *
 * Prerequisites:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-service-account.json
 *
 * Usage:
 *   node scripts/purge-e2e-data.mjs [--dry-run]
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');

if (DRY_RUN) {
  console.log('🔍 DRY RUN — no documents will be deleted\n');
}

// Init Firebase Admin
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  console.error('Error: GOOGLE_APPLICATION_CREDENTIALS must be set');
  process.exit(1);
}
const serviceAccount = JSON.parse(readFileSync(credPath, 'utf8'));
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

let totalDeleted = 0;

async function deleteDoc(ref, label) {
  if (DRY_RUN) {
    console.log(`  [dry-run] would delete: ${label}`);
  } else {
    await ref.delete();
    console.log(`  deleted: ${label}`);
  }
  totalDeleted++;
}

/**
 * Delete all docs in a subcollection of a given parent doc.
 */
async function purgeSubcollection(parentRef, subcollection) {
  const snap = await parentRef.collection(subcollection).get();
  for (const doc of snap.docs) {
    await deleteDoc(doc.ref, `${parentRef.path}/${subcollection}/${doc.id}`);
  }
}

/**
 * Delete docs from a top-level collection where a field matches a predicate.
 * Also deletes specified subcollections on each matched doc.
 */
async function purgeCollection(collection, fieldName, predicate, subcollections = []) {
  const snap = await db.collection(collection).get();
  let count = 0;
  for (const doc of snap.docs) {
    const value = doc.data()[fieldName] ?? '';
    if (predicate(value)) {
      count++;
      for (const sub of subcollections) {
        await purgeSubcollection(doc.ref, sub);
      }
      await deleteDoc(doc.ref, `${collection}/${doc.id} (${fieldName}="${value}")`);
    }
  }
  if (count === 0) console.log(`  (none found)`);
}

const isE2E = (val) => typeof val === 'string' && val.startsWith('E2E ');
const isE2EEmail = (val) => typeof val === 'string' && /^e2e-/i.test(val);

// ── Teams (name starts with "E2E ") ────────────────────────────────────────
console.log('\n📋 Teams (name starts with "E2E ")');
await purgeCollection('teams', 'name', isE2E, ['players', 'events', 'scheduleConfig', 'invites']);

// ── Root-level events with E2E titles ─────────────────────────────────────
console.log('\n📅 Root events (title starts with "E2E ")');
await purgeCollection('events', 'title', isE2E);

// ── Leagues (name starts with "E2E ") ─────────────────────────────────────
console.log('\n🏆 Leagues (name starts with "E2E ")');
await purgeCollection('leagues', 'name', isE2E, ['seasons', 'wizardDraft', 'divisions']);

// ── Venues (name starts with "E2E ") ──────────────────────────────────────
console.log('\n🏟️  Venues (name starts with "E2E ")');
await purgeCollection('venues', 'name', isE2E);

// ── Users created by E2E (email matches e2e-*@example.com or displayName "E2E ") ──
console.log('\n👤 Users (email e2e-*@example.com or displayName starts with "E2E ")');
const usersSnap = await db.collection('users').get();
let userCount = 0;
for (const doc of usersSnap.docs) {
  const { email = '', displayName = '' } = doc.data();
  if (isE2EEmail(email) || isE2E(displayName)) {
    userCount++;
    await deleteDoc(doc.ref, `users/${doc.id} (${email || displayName})`);
  }
}
if (userCount === 0) console.log('  (none found)');

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n✅ ${DRY_RUN ? 'Would delete' : 'Deleted'} ${totalDeleted} document(s) total.`);
if (DRY_RUN) {
  console.log('   Run without --dry-run to apply.\n');
}
