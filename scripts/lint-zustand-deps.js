#!/usr/bin/env node
/**
 * lint-zustand-deps.js
 *
 * Detects the dangerous pattern where a Zustand store action (a function selector)
 * is assigned via `useXxxStore(s => s.someAction)` and then used in a useEffect
 * (or useCallback/useMemo) dependency array.
 *
 * Why this matters: store actions accessed this way can cause stale-closure bugs
 * and — when combined with reactive dep arrays — render loops. The confirmed
 * instance (SeasonDashboard.tsx subscribeVenues, issue #192) triggered an
 * infinite render loop in staging.
 *
 * The script maintains an ALLOWLIST of pre-existing violations so it blocks only
 * NEW occurrences without failing CI on debt that predates this check.
 * Remove an entry from the allowlist once the source file is fixed.
 *
 * Scope: flags selectors returning store ACTIONS (functions matching action naming
 * conventions: subscribe, fetch*, load*, add*, update*, delete*, soft*, create*,
 * remove*, set*, reset*, clear*, save*, init*, refresh*, sync*). Data state
 * fields (teams, events, user, loading, etc.) are intentionally excluded.
 *
 * Safe fix: call `useXxxStore.getState().action()` inside the effect body so the
 * function reference never enters the dep array.
 *
 * Usage:
 *   node scripts/lint-zustand-deps.js [--dir src]
 *   Exit 0 = clean (or only allowlisted violations). Exit 1 = new violations found.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT_DIR = process.argv.includes('--dir')
  ? process.argv[process.argv.indexOf('--dir') + 1]
  : 'src';

// ---------------------------------------------------------------------------
// ALLOWLIST — pre-existing violations as of GitHub issue #192.
// Format: "<relative-file-path>:<varName>"
// Each entry silences exactly one (file, variable) pair.
// Remove the entry once the source file is fixed.
// ---------------------------------------------------------------------------
const ALLOWLIST = new Set([
  // TODO #192: migrate these to useXxxStore.getState().action() pattern
  'src/pages/CoachAvailabilityPage.tsx:loadCollection',
  'src/pages/LeagueDetailPage.tsx:fetchSeasons',
  'src/pages/LeagueDetailPage.tsx:loadCollection',
  'src/pages/LeagueDetailPage.tsx:loadWizardDraft',
  'src/pages/SeasonDashboard.tsx:fetchSeasons',
  'src/pages/SeasonDashboard.tsx:fetchDivisions',
  'src/pages/SeasonDashboard.tsx:subscribeVenues',
  'src/pages/TeamDetailPage.tsx:loadAvailability',
  'src/pages/VenuesPage.tsx:subscribe',
]);

/**
 * Action field name prefixes — selectors returning these are flagged.
 * Pure state fields (teams, events, user, profile, loading, error, etc.) are not.
 */
const ACTION_PREFIXES = [
  'subscribe',
  'fetch',
  'load',
  'add',
  'update',
  'delete',
  'softDelete',
  'soft',
  'create',
  'remove',
  'set',
  'reset',
  'clear',
  'save',
  'init',
  'refresh',
  'sync',
];

/**
 * Returns true if the field name looks like a store action rather than a data
 * property (camelCase prefix boundary check).
 * @param {string} field
 */
function isActionField(field) {
  return ACTION_PREFIXES.some(prefix => {
    if (prefix === field) return true; // exact match e.g. "subscribe"
    if (field.startsWith(prefix) && field.length > prefix.length) {
      const next = field[prefix.length];
      return next === next.toUpperCase(); // camelCase boundary
    }
    return false;
  });
}

/**
 * Walk a directory recursively, returning .ts and .tsx file paths.
 * @param {string} dir
 * @returns {string[]}
 */
function walkFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (['.ts', '.tsx'].includes(extname(full))) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Scan one file for the dangerous pattern (line-level heuristic, no AST).
 *
 * 1. Find `const <varName> = use<Xxx>Store(s => s.<actionField>)` lines where
 *    <actionField> matches action naming conventions.
 * 2. Check if <varName> appears in a hook dep array closing line:
 *    `}, [... varName ...])`
 *
 * @param {string} filePath  Absolute path
 * @param {string} relPath   Path relative to cwd (used for allowlist lookup)
 * @param {string} source
 * @returns {Array<{file:string, relPath:string, depLine:number, selectorLine:number, varName:string, storeCall:string, allowlisted:boolean}>}
 */
function scanFile(filePath, relPath, source) {
  const lines = source.split('\n');
  const violations = [];

  // Match: const someVar = useFooStore(s => s.something)
  const selectorPattern = /^\s*const\s+(\w+)\s*=\s*(use\w+Store)\s*\(\s*s\s*=>\s*s\.(\w+)\s*\)/;

  // Match a hook closing line with a dep array: }, [...]) or ], [...])
  const depsLinePattern = /[}\]]\s*,\s*\[([^\]]*)\]\s*\)/;

  // Collect action selectors only
  const actionSelectors = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(selectorPattern);
    if (m) {
      const [, varName, storeName, field] = m;
      if (isActionField(field)) {
        actionSelectors.set(varName, { storeName, field, lineNumber: i + 1 });
      }
    }
  }

  if (actionSelectors.size === 0) return violations;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(depsLinePattern);
    if (!m) continue;

    const deps = m[1].split(',').map(d => d.trim()).filter(Boolean);

    for (const dep of deps) {
      if (actionSelectors.has(dep)) {
        const sel = actionSelectors.get(dep);
        const allowlistKey = `${relPath}:${dep}`;
        violations.push({
          file: filePath,
          relPath,
          depLine: i + 1,
          selectorLine: sel.lineNumber,
          varName: dep,
          storeCall: `${sel.storeName}(s => s.${sel.field})`,
          allowlisted: ALLOWLIST.has(allowlistKey),
        });
      }
    }
  }

  return violations;
}

// ---- Main ----

const cwd = process.cwd();
const files = walkFiles(ROOT_DIR);
const allViolations = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const relPath = file.startsWith(cwd + '/') ? file.slice(cwd.length + 1) : file;
  const violations = scanFile(file, relPath, source);
  allViolations.push(...violations);
}

const newViolations = allViolations.filter(v => !v.allowlisted);
const allowlistedCount = allViolations.length - newViolations.length;

if (allViolations.length === 0) {
  console.log('lint-zustand-deps: OK — no Zustand action dep patterns found.');
  process.exit(0);
}

if (newViolations.length === 0) {
  console.log(
    `lint-zustand-deps: OK — ${allowlistedCount} allowlisted violation(s) (pre-existing debt, tracked in issue #192).`
  );
  process.exit(0);
}

// Report new violations
console.error(
  `lint-zustand-deps: FAIL — ${newViolations.length} new Zustand action dep violation(s) found.\n`
);
console.error(
  'Store actions accessed via selector (useStore(s => s.action)) must not appear\n' +
  'in useEffect/useCallback/useMemo dependency arrays. This creates stale-closure\n' +
  'risk and can cause infinite render loops.\n\n' +
  'Fix: call useXxxStore.getState().action() inside the effect body instead,\n' +
  'so the function reference never enters the dep array.\n'
);

for (const v of newViolations) {
  console.error(
    `  ${v.file}\n` +
    `    Line ${v.selectorLine}: const ${v.varName} = ${v.storeCall}\n` +
    `    Line ${v.depLine}:   ${v.varName} appears in hook dependency array\n`
  );
}

if (allowlistedCount > 0) {
  console.error(
    `\n(${allowlistedCount} pre-existing violation(s) suppressed via allowlist — tracked in issue #192)`
  );
}

process.exit(1);
