# First Whistle — Operations Runbook
**Purpose:** Reference for scripts, maintenance tasks, and one-off admin procedures.
**Format:** Each entry covers what the script does, when to run it, preconditions, and whether it is idempotent.

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
