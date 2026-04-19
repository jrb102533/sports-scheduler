---
name: Pre-existing suite failure — useDmStore
description: src/store/useDmStore.test.ts throws auth/invalid-api-key at import time; 0 tests run; pre-exists on main
type: project
---

`src/store/useDmStore.test.ts` fails at module load time with `FirebaseError: auth/invalid-api-key` because it imports `src/lib/firebase.ts` directly without mocking it. The suite reports 1 failed file, 0 tests executed from that file.

**Confirmed pre-existing on main as of 2026-04-18** — verified by stashing branch changes and re-running the isolated file; identical failure.

**Why:** The test file does not mock `@/lib/firebase` before import, so the real Firebase SDK initializes with the missing/dummy API key in the CI/test environment.

**How to apply:** When reviewing future PRs, this file failing is NOT a regression signal for the branch under review. Flag it only if the test count changes (i.e. the error message changes or new tests start failing). Log a separate issue to fix the missing mock in useDmStore.test.ts.
