# First Whistle — Operations Runbook
**Purpose:** Reference for scripts, maintenance tasks, and one-off admin procedures.
**Format:** Each entry covers what the script does, when to run it, preconditions, and whether it is idempotent.

---

## Table of Contents

1. [Scripts](#scripts)
2. [E2E Test Data Seeding](#e2e-test-data-seeding)
3. [Manually Wipe E2E Seed Data](#manually-wipe-e2e-seed-data)
4. [Manually Re-seed E2E Data](#manually-re-seed-e2e-data)

---

## Scripts

### `scripts/backfill-coach-ids.mjs`
**What it does:** For every team document that has a `coachId` scalar but no `coachIds` array, writes `coachIds: [coachId]`. Teams that already have `coachIds` are skipped.

**When to run:** After deploying any code that introduces `coachIds` checks, and whenever new teams may have been created before the `coachIds` field was established. Must also be run against production before the coachIds sweep PR goes fully live.

**Idempotent:** Yes — safe to run multiple times.

**Preconditions:**
- Service account credentials: `GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/first-whistle-e76f4-firebase-adminsdk-*.json`
- Run from the `functions/` directory

**Command:**
```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/first-whistle-e76f4-firebase-adminsdk-fbsvc-3b2a1b24a4.json \
node ../scripts/backfill-coach-ids.mjs
```

**Expected output:** Lists each team queued for update, then prints `Done. Updated N teams, skipped M.` If already run, prints `Nothing to backfill — all teams already have coachIds.`

---

### `scripts/reset-must-change-account.mjs`
**What it does:** Finds the staging user with `mustChangePassword: true` in Firestore, resets their Firebase Auth password to a known value (`E2eForce2026!`), and confirms the Firestore flag is still set. Used to restore the E2E test account for the forced-password-change flow.

**When to run:** When the `E2E_MUST_CHANGE_PASSWORD` GitHub secret needs to be reset, or when the must-change test account password becomes unknown.

**Idempotent:** Yes — safe to run multiple times.

**Preconditions:**
- Service account credentials (same as above)
- Run from the `functions/` directory
- At least one user must have `mustChangePassword: true` in Firestore

**Command:**
```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/first-whistle-e76f4-firebase-adminsdk-fbsvc-3b2a1b24a4.json \
node ../scripts/reset-must-change-account.mjs
```

**After running:** Update GitHub secrets `E2E_MUST_CHANGE_EMAIL` and `E2E_MUST_CHANGE_PASSWORD` with the values printed.

---

## E2E Test Data Seeding

### Overview

The Playwright E2E suite uses a synthetic seeding system to eliminate fragile dependencies
on pre-existing staging data (previously ~40 hardcoded "Sharks" team references).

**global-setup.ts** runs before every Playwright test run and:
1. Logs in each role account (admin, coach, parent, player, LM) and saves session state.
2. Seeds a known isolated dataset into Firestore using the Firebase Admin SDK.

**global-teardown.ts** runs after all tests complete and:
1. Queries each Firestore collection for documents tagged `isE2eData: true`.
2. Batch-deletes all matching documents, including subcollections.

### Seeded documents

All seeded documents are tagged `isE2eData: true` and named with the "E2E " prefix:

| Collection | Document | Notes |
|---|---|---|
| `leagues` | E2E Test League | Top-level fixture |
| `leagues/{id}/seasons` | E2E Season {year} | Subcollection; teamIds = [teamAId, teamBId] |
| `teams` | E2E Team A | coachIds includes the E2E coach account UID |
| `teams` | E2E Team B | No coach — opposing team only |
| `events` | E2E Test Game | Past-dated game (yesterday), status=published, no result |
| `venues` | E2E Test Venue | homeVenueId on Team A |

The seeded IDs are written to `e2e/.auth/test-data.json` (gitignored).

### Credentials required

Seeding requires the Firebase Admin SDK, which needs a service account JSON:

```bash
# Local development
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-service-account.json

# CI — decoded from the E2E_FIREBASE_SERVICE_ACCOUNT_JSON GitHub Actions secret
echo "$E2E_FIREBASE_SERVICE_ACCOUNT_JSON" | base64 -d > /tmp/sa.json
export GOOGLE_APPLICATION_CREDENTIALS=/tmp/sa.json
```

The service account needs:
- `Cloud Datastore User` — Firestore read/write
- `Firebase Authentication Admin` — look up the coach UID by email

Without these credentials, seeding is skipped and data-dependent tests self-skip.

### Seed/teardown cycle

```
Before tests:    global-setup.ts   → seed + write test-data.json
During tests:    tests read test-data.json → navigate directly via IDs
After tests:     global-teardown.ts → delete all isE2eData documents
```

The cycle repeats on every run. Seeding is idempotent — if teardown was skipped (e.g. a
CI job was cancelled) the next run will reuse existing documents rather than creating duplicates.

---

## Manually Wipe E2E Seed Data

Use this when staging is in a bad state — for example if teardown failed and stale E2E
documents are interfering with tests, or if a seeded event already has a result recorded
(which hides the "Submit Result" section and causes STAND-RT-01 to skip).

### Option A — Firebase Console (fastest for small datasets)

1. Open the Firebase Console → Firestore → Data tab for your staging project.
2. Filter each of these collections by `isE2eData == true`:
   - `teams`
   - `leagues` (and their `seasons` subcollections)
   - `events`
   - `venues`
3. Delete all matching documents.

### Option B — Run teardown manually (recommended)

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-service-account.json
npx tsx e2e/global-teardown.ts
```

### Option C — Delete via Admin SDK script

```javascript
// scripts/wipe-e2e-data.mjs
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS) });
const db = getFirestore();

const COLLECTIONS = ['teams', 'leagues', 'events', 'venues'];

for (const col of COLLECTIONS) {
  const snap = await db.collection(col).where('isE2eData', '==', true).get();
  for (const doc of snap.docs) {
    if (col === 'leagues') {
      const seasonsSnap = await doc.ref.collection('seasons').get();
      for (const s of seasonsSnap.docs) await s.ref.delete();
    }
    await doc.ref.delete();
    console.log(`Deleted ${col}/${doc.id}`);
  }
}
```

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-sa.json node scripts/wipe-e2e-data.mjs
```

---

## Manually Re-seed E2E Data

Use this when you need the seeded dataset without running the full test suite.

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-service-account.json
npx playwright test --project=chromium --grep "^$"  # matches no tests, runs setup/teardown only
```

After re-seeding, `e2e/.auth/test-data.json` contains the new IDs and tests will use them.

---

## Related Documentation

- `e2e/README.md` — E2E suite setup, env vars, test account requirements
- `docs/GO_LIVE_CHECKLIST.md` — manual + automated pre-launch checklist
- `docs/CHANGE_CONTROL.md` — branch strategy, PR gates, deploy pipeline
