#!/usr/bin/env node
/**
 * lint-zustand-deps.js
 *
 * Two related Zustand anti-pattern checks that can cause React error #185
 * (infinite render loop / complete site outage):
 *
 * CHECK 1 — Action-in-deps (original check):
 *   Detects where a Zustand store action is selected via
 *   `useXxxStore(s => s.someAction)` and then placed in a useEffect/useCallback/
 *   useMemo dependency array. Actions have unstable references and re-trigger
 *   effects on every render, causing infinite loops.
 *
 * CHECK 2 — No-selector bare call (new check for issue #192):
 *   Detects `useXxxStore()` called with NO selector argument at all, e.g.:
 *     const { fetchSeasons } = useSeasonStore();   // BAD — subscribes to entire store
 *   This subscribes the component to the entire store state. Any store mutation
 *   (from any field) re-renders the component. When combined with a useEffect
 *   that mutates the store, this creates an infinite render loop.
 *
 * Both checks maintain an ALLOWLIST of pre-existing violations so CI blocks only
 * NEW occurrences. Remove entries from the allowlist once the source file is fixed.
 *
 * Safe fix for both patterns:
 *   - Data state:  const value = useXxxStore(s => s.field)
 *   - Actions:     useXxxStore.getState().action() inside the effect body
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
// CHECK 1 ALLOWLIST — action-in-deps pre-existing violations (issue #192).
// Format: "<relative-file-path>:<varName>"
// Remove an entry once the source file is fixed.
// ---------------------------------------------------------------------------
const ACTION_DEPS_ALLOWLIST = new Set([
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

// ---------------------------------------------------------------------------
// CHECK 2 ALLOWLIST — no-selector bare calls pre-existing as of issue #192.
// Format: "<relative-file-path>:<line-number>"
// Each entry silences exactly one (file, line) pair.
// Remove the entry once the source file is migrated to selector form.
// ---------------------------------------------------------------------------
const NO_SELECTOR_ALLOWLIST = new Set([
  // TODO #192: migrate these to useXxxStore(s => s.field) or getState() pattern
  'src/components/attendance/AttendanceTracker.tsx:21',
  'src/components/roster/PlayerAvailabilityModal.tsx:30',
  'src/components/roster/AbsenceFormModal.tsx:28',
  'src/components/roster/MarkAbsenceModal.tsx:40',
  'src/components/roster/PlayerStatusModal.tsx:24',
  'src/components/roster/RosterTable.tsx:94',
  'src/components/roster/PlayerForm.tsx:78',
  'src/components/auth/ProtectedRoute.tsx:9',
  'src/components/layout/TopBar.tsx:13',
  'src/components/layout/NotificationPanel.tsx:7',
  'src/components/layout/Sidebar.tsx:51',
  'src/components/leagues/AvailabilityStatusPanel.tsx:104',
  'src/components/leagues/CoachAvailabilityModal.tsx:82',
  'src/components/leagues/CoachAvailabilityForm.tsx:110',
  'src/components/leagues/ScheduleWizardModal.tsx:416',
  'src/components/leagues/ScheduleWizardModal.tsx:417',
  'src/components/teams/TeamForm.tsx:32',
  'src/components/events/EventForm.tsx:110',
  'src/components/events/EventForm.tsx:114',
  'src/components/events/SnackVolunteerForm.tsx:14',
  'src/components/events/ImportEventsModal.tsx:175',
  'src/layouts/MainLayout.tsx:44',
  'src/pages/LoginPage.tsx:11',
  'src/pages/SettingsPage.tsx:40',
  'src/pages/ProfilePage.tsx:31',
  'src/pages/TeamsPage.tsx:20',
  'src/pages/NotificationsPage.tsx:11',
  'src/pages/LeaguesPage.tsx:15',
  'src/pages/LeaguesPage.tsx:16',
  'src/pages/LeaguesPage.tsx:17',
  'src/pages/TeamDetailPage.tsx:49',
  'src/pages/TeamDetailPage.tsx:51',
  'src/pages/StandingsPage.tsx:11',
  'src/pages/LeagueDetailPage.tsx:33',
  'src/pages/LeagueDetailPage.tsx:34',
  'src/pages/SignupPage.tsx:19',
  'src/pages/CoachAvailabilityPage.tsx:21',
  'src/pages/VenuesPage.tsx:491',
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
 * CHECK 1: Scan one file for the action-in-deps pattern.
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
function scanActionDeps(filePath, relPath, source) {
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
          allowlisted: ACTION_DEPS_ALLOWLIST.has(allowlistKey),
        });
      }
    }
  }

  return violations;
}

/**
 * CHECK 2: Scan one file for no-selector bare store calls.
 *
 * Detects: useXxxStore() with no arguments (or only whitespace).
 * These subscribe the component to the entire store and cause unnecessary
 * re-renders on every state change — the root cause of React error #185.
 *
 * Excludes test files (.test.ts, .test.tsx, .spec.ts, .spec.tsx) and __mocks__
 * since test infrastructure legitimately intercepts store calls.
 *
 * @param {string} filePath  Absolute path
 * @param {string} relPath   Path relative to cwd (used for allowlist lookup)
 * @param {string} source
 * @returns {Array<{file:string, relPath:string, lineNumber:number, match:string, allowlisted:boolean}>}
 */
function scanNoSelector(filePath, relPath, source) {
  // Skip test and mock files — they legitimately use bare calls for mocking
  if (
    /\.(test|spec)\.(tsx?|jsx?)$/.test(filePath) ||
    filePath.includes('__mocks__')
  ) {
    return [];
  }

  const lines = source.split('\n');
  const violations = [];

  // Match: useXxxStore() — zero or whitespace-only args
  // Excludes: useXxxStore(s => ...) and useXxxStore.getState()
  const noSelectorPattern = /\buse[A-Z][a-zA-Z]*Store\(\s*\)/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(noSelectorPattern);
    if (m) {
      const allowlistKey = `${relPath}:${i + 1}`;
      violations.push({
        file: filePath,
        relPath,
        lineNumber: i + 1,
        match: m[0],
        line: lines[i].trim(),
        allowlisted: NO_SELECTOR_ALLOWLIST.has(allowlistKey),
      });
    }
  }

  return violations;
}

// ---- Main ----

const cwd = process.cwd();
const files = walkFiles(ROOT_DIR);

const allActionDepsViolations = [];
const allNoSelectorViolations = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const relPath = file.startsWith(cwd + '/') ? file.slice(cwd.length + 1) : file;
  allActionDepsViolations.push(...scanActionDeps(file, relPath, source));
  allNoSelectorViolations.push(...scanNoSelector(file, relPath, source));
}

const newActionDepsViolations = allActionDepsViolations.filter(v => !v.allowlisted);
const allowlistedActionDepsCount = allActionDepsViolations.length - newActionDepsViolations.length;

const newNoSelectorViolations = allNoSelectorViolations.filter(v => !v.allowlisted);
const allowlistedNoSelectorCount = allNoSelectorViolations.length - newNoSelectorViolations.length;

const totalNew = newActionDepsViolations.length + newNoSelectorViolations.length;
const totalAllowlisted = allowlistedActionDepsCount + allowlistedNoSelectorCount;

// ---- Report ----

if (totalNew === 0) {
  if (totalAllowlisted > 0) {
    console.log(
      `lint-zustand-deps: OK — ${totalAllowlisted} allowlisted violation(s) (pre-existing debt, tracked in issue #192).`
    );
  } else {
    console.log('lint-zustand-deps: OK — no Zustand anti-patterns found.');
  }
  process.exit(0);
}

// Report new violations
console.error(
  `lint-zustand-deps: FAIL — ${totalNew} new Zustand anti-pattern violation(s) found.\n`
);

if (newActionDepsViolations.length > 0) {
  console.error('── CHECK 1: Action-in-deps violations ──────────────────────────────────');
  console.error(
    'Store actions accessed via selector (useStore(s => s.action)) must not appear\n' +
    'in useEffect/useCallback/useMemo dependency arrays. This creates stale-closure\n' +
    'risk and can cause infinite render loops.\n\n' +
    'Fix: call useXxxStore.getState().action() inside the effect body instead,\n' +
    'so the function reference never enters the dep array.\n'
  );

  for (const v of newActionDepsViolations) {
    console.error(
      `  ${v.file}\n` +
      `    Line ${v.selectorLine}: const ${v.varName} = ${v.storeCall}\n` +
      `    Line ${v.depLine}:   ${v.varName} appears in hook dependency array\n`
    );
  }
}

if (newNoSelectorViolations.length > 0) {
  console.error('── CHECK 2: No-selector bare store call violations ─────────────────────');
  console.error(
    'useXxxStore() called with no selector subscribes the component to the ENTIRE\n' +
    'store. Any store mutation causes a re-render. Combined with a useEffect that\n' +
    'mutates the store, this creates an infinite render loop (React error #185).\n\n' +
    'Fix: select only the fields you need:\n' +
    '  const value = useXxxStore(s => s.field)       // for data\n' +
    '  useXxxStore.getState().action()                // for actions inside effects\n'
  );

  for (const v of newNoSelectorViolations) {
    console.error(
      `  ${v.file}\n` +
      `    Line ${v.lineNumber}: ${v.line}\n`
    );
  }
}

if (totalAllowlisted > 0) {
  console.error(
    `\n(${totalAllowlisted} pre-existing violation(s) suppressed via allowlist — tracked in issue #192)`
  );
}

process.exit(1);
