#!/usr/bin/env node
/**
 * migrate-rsvps-to-subcollection.mjs — FW-90b migration
 *
 * Walks all events that have a populated rsvps[] array and creates the
 * corresponding subcollection docs under events/{id}/rsvps/{docKey}.
 *
 * This is the cutover step that allows PR 2 (FW-90b) to drop the legacy
 * array reads and writes from the dispatcher and rsvpEvent handler.
 *
 * Idempotent: if a subcollection doc already exists for a given docKey, it is
 * left untouched (skipped). Safe to run multiple times.
 *
 * Run BEFORE deploying the FW-90b functions build (see PR description).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/<service-account-key>.json \
 *   node scripts/migrate-rsvps-to-subcollection.mjs [--dry-run] [--project staging|production]
 *
 * Options:
 *   --dry-run     Log what would be written without touching Firestore.
 *   --project     firebase project alias (not used directly here; set GOOGLE_APPLICATION_CREDENTIALS for the target project)
 *
 * Cost estimate (one-time run):
 *   R: 1 events query (all docs with rsvps array non-empty) + 1 subcollection
 *      exists-check per rsvp entry (batched as individual doc reads).
 *   W: 1 subcollection doc set() per un-migrated rsvp entry.
 *   Typical: tens to hundreds of events × 10-20 rsvp entries each.
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ─── Init ─────────────────────────────────────────────────────────────────────

if (!getApps().length) initializeApp();
const db = getFirestore();

const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) console.log('[migrate-rsvps] DRY RUN — no writes will occur');

// ─── Sanitize an email address to a valid Firestore document ID ───────────────
// Mirrors the scheme used in rsvpEvent post-FW-90a: replace @ and . with _.

function sanitizeEmail(email) {
  return email.replace(/[@.]/g, '_');
}

// ─── Derive subcollection docKey from a legacy rsvps[] array entry ────────────
//
// Legacy array entries were written by rsvpEvent before FW-90a. The `playerId`
// field on each entry is the "recipientKey" — one of:
//   - A bare Firebase Auth uid (self-RSVP via dispatcher-generated link)
//   - A uid_childId composite (proxy RSVP via dispatcher-generated link)
//   - A raw email address (when the recipient had no uid at link-gen time)
//
// This function returns the docKey and a parsed sub-doc shape.

function parseArrayEntry(entry) {
  const recipientKey = entry.playerId ?? '';
  if (!recipientKey) return null;

  const isEmail = recipientKey.includes('@');

  const docKey = isEmail
    ? `email_${sanitizeEmail(recipientKey)}`
    : recipientKey;

  const doc = {
    name: entry.name ?? 'Guest',
    response: entry.response ?? 'yes',
    source: 'email-legacy',
    updatedAt: entry.respondedAt ?? new Date().toISOString(),
  };

  if (isEmail) {
    doc.email = recipientKey;
  } else {
    const parts = recipientKey.split('_');
    doc.uid = parts[0];
    if (parts.length > 1) doc.playerId = parts[1];
  }

  return { docKey, doc };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[migrate-rsvps] querying events with non-empty rsvps array...');

  // Firestore does not support "array is non-empty" as a filter, so we fetch
  // all events and filter in-memory. If the collection is large, paginate.
  // For typical First Whistle scale (hundreds of events) this is fine.
  const eventsSnap = await db.collection('events').get();

  let totalEvents = 0;
  let skippedEvents = 0;
  let totalEntries = 0;
  let migratedEntries = 0;
  let skippedEntries = 0;
  let errorEntries = 0;

  for (const evDoc of eventsSnap.docs) {
    const data = evDoc.data();
    const rsvps = Array.isArray(data.rsvps) ? data.rsvps : [];

    if (!rsvps.length) {
      skippedEvents++;
      continue;
    }

    totalEvents++;
    console.log(`\n[migrate-rsvps] event=${evDoc.id} — ${rsvps.length} legacy rsvp(s)`);

    for (const entry of rsvps) {
      totalEntries++;

      const parsed = parseArrayEntry(entry);
      if (!parsed) {
        console.warn(`  [skip] entry missing playerId: ${JSON.stringify(entry)}`);
        skippedEntries++;
        continue;
      }

      const { docKey, doc } = parsed;
      const subRef = db.doc(`events/${evDoc.id}/rsvps/${docKey}`);

      // Idempotency check: skip if doc already exists.
      let existingSnap;
      try {
        existingSnap = await subRef.get();
      } catch (err) {
        console.error(`  [error] reading events/${evDoc.id}/rsvps/${docKey}: ${err.message}`);
        errorEntries++;
        continue;
      }

      if (existingSnap.exists) {
        console.log(`  [skip] events/${evDoc.id}/rsvps/${docKey} already exists — skipping`);
        skippedEntries++;
        continue;
      }

      console.log(`  [write] events/${evDoc.id}/rsvps/${docKey} source=email-legacy response=${doc.response}`);

      if (!DRY_RUN) {
        try {
          await subRef.set(doc);
          migratedEntries++;
        } catch (err) {
          console.error(`  [error] writing events/${evDoc.id}/rsvps/${docKey}: ${err.message}`);
          errorEntries++;
        }
      } else {
        migratedEntries++;
      }
    }
  }

  console.log('\n[migrate-rsvps] done.');
  console.log(`  Events with rsvps[]: ${totalEvents}`);
  console.log(`  Events skipped (empty array): ${skippedEvents}`);
  console.log(`  Total legacy entries processed: ${totalEntries}`);
  console.log(`  Migrated (wrote subcollection doc): ${migratedEntries}${DRY_RUN ? ' (dry-run)' : ''}`);
  console.log(`  Skipped (already exists or missing playerId): ${skippedEntries}`);
  console.log(`  Errors: ${errorEntries}`);

  if (errorEntries > 0) {
    console.error('\n[migrate-rsvps] completed with errors — review logs above and re-run to retry failed entries.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[migrate-rsvps] fatal error:', err);
  process.exit(1);
});
