#!/usr/bin/env node
/**
 * Pre-deploy guard: verifies the dist/ bundle contains the staging Firebase
 * project ID, not the production one. Fails hard if the wrong config was baked in.
 *
 * Run automatically via the predeploy:staging npm hook, or manually:
 *   node scripts/check-staging-build.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const STAGING_PROJECT = 'first-whistle-e76f4';
const PROD_PROJECT = 'first-whistle-prod';
const DIST_ASSETS = join(process.cwd(), 'dist', 'assets');

let files;
try {
  files = readdirSync(DIST_ASSETS).filter(f => f.endsWith('.js'));
} catch {
  console.error('❌  dist/assets not found — run npm run build:staging first.');
  process.exit(1);
}

if (files.length === 0) {
  console.error('❌  No JS bundles found in dist/assets.');
  process.exit(1);
}

// Check the largest JS file (main bundle)
const mainBundle = files
  .map(f => ({ f, size: readFileSync(join(DIST_ASSETS, f)).length }))
  .sort((a, b) => b.size - a.size)[0].f;

const content = readFileSync(join(DIST_ASSETS, mainBundle), 'utf8');

if (content.includes(PROD_PROJECT)) {
  console.error(`❌  ABORT: dist bundle contains production project ID "${PROD_PROJECT}".`);
  console.error('    You built with plain "npm run build" instead of "npm run build:staging".');
  console.error('    Run: npm run build:staging && firebase deploy --only hosting --project staging');
  process.exit(1);
}

if (!content.includes(STAGING_PROJECT)) {
  console.error(`❌  ABORT: dist bundle does not contain staging project ID "${STAGING_PROJECT}".`);
  console.error('    Run: npm run build:staging && firebase deploy --only hosting --project staging');
  process.exit(1);
}

console.log(`✅  Staging config verified (${STAGING_PROJECT}) — safe to deploy.`);
