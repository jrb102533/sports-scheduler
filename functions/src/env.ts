/**
 * Environment helper — single source of truth for "where is this function running?"
 *
 * Used to gate code paths that should differ between production, staging, and
 * the local Functions emulator. Especially: scheduled jobs that have no value
 * on staging (no real users to notify) but burn Firestore reads if they run.
 *
 * See ADR-012 (cost-discipline architecture) for the rationale.
 */

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? '';

const STAGING_PROJECT = 'first-whistle-e76f4';
const PROD_PROJECT = 'first-whistle-prod';

export const ENV = {
  /** True when running on the staging Firebase project. */
  isStaging: (): boolean => PROJECT_ID === STAGING_PROJECT,

  /** True when running on the production Firebase project. */
  isProduction: (): boolean => PROJECT_ID === PROD_PROJECT,

  /** True when running inside the local Firebase Functions emulator. */
  isEmulator: (): boolean => process.env.FUNCTIONS_EMULATOR === 'true',

  /**
   * Should scheduled jobs (`onSchedule(...)`) actually do work?
   *
   *   Production → YES, always.
   *   Emulator   → NO  (emulator is for unit/integration tests, not cron sims).
   *   Staging    → NO by default. There are no real users to notify, and each
   *                fire reads hundreds-to-thousands of Firestore docs to build
   *                recipient lists that go nowhere. Override on a specific
   *                staging deploy by setting STAGING_ENABLE_SCHEDULES=true.
   *
   * Each scheduled CF should call this on its first line and return early
   * when false:
   *
   *   export const myJob = onSchedule(..., async () => {
   *     if (!ENV.shouldRunScheduledJobs()) {
   *       console.log('[myJob] skipped: scheduled jobs disabled in this env');
   *       return;
   *     }
   *     // ... real work
   *   });
   */
  shouldRunScheduledJobs: (): boolean => {
    if (ENV.isProduction()) return true;
    if (ENV.isEmulator()) return false;
    return process.env.STAGING_ENABLE_SCHEDULES === 'true';
  },
};
