/**
 * Loads the seeded E2E test data written by global-setup.ts.
 *
 * Returns the TestData object if the file exists and is populated,
 * or null if GOOGLE_APPLICATION_CREDENTIALS was not set during global-setup
 * (i.e. the seeding step was skipped).
 *
 * Usage in spec files:
 *
 *   import { loadTestData } from './helpers/test-data';
 *
 *   test('my test', async ({ asCoach }) => {
 *     const testData = loadTestData();
 *     if (!testData) {
 *       test.skip(true, 'E2E seed data not available — set GOOGLE_APPLICATION_CREDENTIALS');
 *       return;
 *     }
 *     // use testData.teamAId, testData.eventId, etc.
 *   });
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TestData {
  leagueId: string;
  seasonId: string;
  teamAId: string;
  teamBId: string;
  eventId: string;
  venueId: string;
  teamAName: string;
  teamBName: string;
}

const TEST_DATA_PATH = path.join(__dirname, '..', '.auth', 'test-data.json');

let _cached: TestData | null | undefined = undefined;

/**
 * Reads test-data.json synchronously.  Cached after first call.
 * Returns null if the file does not exist or is empty (seeding was skipped).
 */
export function loadTestData(): TestData | null {
  if (_cached !== undefined) return _cached;

  if (!fs.existsSync(TEST_DATA_PATH)) {
    _cached = null;
    return null;
  }

  try {
    const raw = fs.readFileSync(TEST_DATA_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<TestData>;

    // Verify the required fields are present — an empty object {} means seeding was skipped
    if (!parsed.leagueId || !parsed.teamAId || !parsed.eventId) {
      _cached = null;
      return null;
    }

    _cached = parsed as TestData;
    return _cached;
  } catch {
    _cached = null;
    return null;
  }
}

/**
 * Same as loadTestData() but throws if data is unavailable.
 * Use only in contexts where seeded data is mandatory (not gracefully skippable).
 */
export function requireTestData(): TestData {
  const data = loadTestData();
  if (!data) {
    throw new Error(
      'E2E test data not available. Ensure GOOGLE_APPLICATION_CREDENTIALS is set ' +
        'and global-setup.ts completed successfully. See e2e/README.md.',
    );
  }
  return data;
}
