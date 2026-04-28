/**
 * Per-test Firestore read-count budget for @emu Playwright specs.
 *
 * Reads `window.__firestoreReads` (installed by `src/lib/firestoreReadCounter.ts`
 * when the app is connected to the emulator) at test teardown, asserts the
 * count is below `READ_BUDGET`, and writes per-test results to
 * `e2e/.read-counts/<run-id>.json` for the CI artifact + PR-comment job.
 *
 * This catches the cost-regression class of bug — adding an unscoped
 * subscription, an N+1 read pattern, or a new global listener — *at code
 * review time*, before the change is merged. See ADR-012 / project_test_strategy.md.
 *
 * Usage: combine with the auth.emu fixture via test.extend chaining, or import
 *   the standalone `withReadBudget` for tests that don't need an authed page:
 *
 *   import { test, expect } from '../fixtures/read-count.fixture.js';
 *
 *   test('admin loads dashboard cheaply', async ({ page }) => {
 *     await page.goto('/');
 *     // budget enforced automatically at teardown
 *   });
 */
import { test as base, type Page } from '@playwright/test';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_READ_BUDGET = Number(process.env.E2E_READ_BUDGET ?? 100);
const ARTIFACT_DIR = resolve(process.cwd(), 'e2e/.read-counts');
const ARTIFACT_FILE = resolve(ARTIFACT_DIR, `run-${process.env.GITHUB_RUN_ID ?? 'local'}.jsonl`);

async function readCounter(page: Page): Promise<number> {
  return page.evaluate(() => (window as { __firestoreReads?: number }).__firestoreReads ?? 0);
}

function appendResult(record: Record<string, unknown>) {
  try {
    mkdirSync(dirname(ARTIFACT_FILE), { recursive: true });
    appendFileSync(ARTIFACT_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    // Don't fail the test on artifact write errors — the assertion already ran.
    console.warn('[read-count.fixture] failed to append artifact:', err);
  }
}

export type ReadCountFixtures = {
  /** Per-test read budget. Override per-test with test.use({ readBudget: 250 }). */
  readBudget: number;
};

export const test = base.extend<ReadCountFixtures>({
  readBudget: [DEFAULT_READ_BUDGET, { option: true }],

  page: async ({ page, readBudget }, use, testInfo) => {
    await use(page);

    // Teardown — only meaningful for @emu tests where the counter was installed.
    let reads = 0;
    try {
      reads = await readCounter(page);
    } catch {
      // Page may already be closed or the counter was never installed (non-emu test).
      return;
    }

    appendResult({
      title: testInfo.title,
      file: testInfo.file,
      project: testInfo.project.name,
      reads,
      budget: readBudget,
      status: testInfo.status,
      ts: new Date().toISOString(),
    });

    // Skip the budget assertion when the test already failed — otherwise we
    // emit a spurious "exceeded budget" error that obscures the real failure
    // (the test may have aborted mid-flow before all reads completed).
    if (testInfo.status === 'failed' || testInfo.status === 'timedOut') return;

    if (reads > readBudget) {
      throw new Error(
        `[read-count] Test "${testInfo.title}" used ${reads} Firestore reads, exceeding budget of ${readBudget}. ` +
          `This usually means an unscoped subscription, N+1 query, or new global listener. ` +
          `See docs/adr/ADR-012 and project_test_strategy.md.`,
      );
    }
  },
});

export { expect } from '@playwright/test';
