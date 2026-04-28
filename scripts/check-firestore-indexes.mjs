#!/usr/bin/env node
/**
 * Advisory check: scan src/ for Firestore queries that combine `where` +
 * `orderBy` (or multiple `where` clauses) and warn if a matching composite
 * index is not declared in `firestore.indexes.json`.
 *
 * The Firebase emulator auto-creates indexes at query time, but production
 * Firestore requires explicit declaration. A query that works in @emu and
 * fails in prod is the canonical "deployed and broken" bug. This script
 * surfaces likely missing indexes at PR time.
 *
 * Limitations:
 *   - Heuristic only — does not parse TypeScript or evaluate dynamic args.
 *     Reports candidate queries; reviewer judges whether each needs an index.
 *   - Single-field where + orderBy on a different field needs an index;
 *     this is the primary regression class we catch.
 *
 * Exit codes:
 *   0 — no candidates (or all candidates have a matching index)
 *   0 — candidates exist (advisory; non-blocking by design — Phase 1)
 *   1 — script error or malformed indexes.json
 *
 * Usage:
 *   node scripts/check-firestore-indexes.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const INDEXES_FILE = join(ROOT, 'firestore.indexes.json');
const SRC_DIRS = ['src', 'functions/src'].map(d => join(ROOT, d));

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'lib') continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      yield full;
    }
  }
}

const WHERE_RE = /where\s*\(\s*['"]([^'"]+)['"]/g;
const ORDERBY_RE = /orderBy\s*\(\s*['"]([^'"]+)['"]/g;

function extractQueryBody(src, openIdx) {
  // openIdx points at the `(` of `query(`. Walk forward, balancing parens.
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

function extractCandidates(src, filePath) {
  const out = [];
  let from = 0;
  while (true) {
    const idx = src.indexOf('query(', from);
    if (idx === -1) break;
    const open = idx + 'query'.length;
    const body = extractQueryBody(src, open);
    from = idx + 6;
    if (!body) continue;
    if (!/collection(Group)?\s*\(/.test(body)) continue;

    const wheres = [...body.matchAll(WHERE_RE)].map(w => w[1]);
    const orders = [...body.matchAll(ORDERBY_RE)].map(o => o[1]);
    // Composite-index candidates: 2+ wheres, OR (where + orderBy on a different field).
    if (wheres.length === 0 && orders.length === 0) continue;
    if (wheres.length === 1 && orders.length === 0) continue;
    if (wheres.length === 0 && orders.length === 1) continue;
    if (wheres.length === 1 && orders.length === 1 && wheres[0] === orders[0]) continue;

    out.push({
      file: filePath.replace(ROOT + '/', ''),
      snippet: body.replace(/\s+/g, ' ').slice(0, 120),
      wheres,
      orders,
    });
  }
  return out;
}

function indexCovers(idx, fields) {
  // idx.fields = [{ fieldPath: 'foo', order: 'ASCENDING' }, ...]
  // We just check that all required fields appear in the index, in any order.
  const idxFields = new Set(idx.fields.map(f => f.fieldPath));
  return fields.every(f => idxFields.has(f));
}

function main() {
  let indexes;
  try {
    indexes = JSON.parse(readFileSync(INDEXES_FILE, 'utf8'));
  } catch (err) {
    console.error(`ERROR: cannot read ${INDEXES_FILE}: ${err.message}`);
    process.exit(1);
  }
  const declared = indexes.indexes ?? [];

  const candidates = [];
  for (const dir of SRC_DIRS) {
    try {
      for (const file of walk(dir)) {
        const src = readFileSync(file, 'utf8');
        candidates.push(...extractCandidates(src, file));
      }
    } catch {
      // Directory may not exist on a given branch — skip.
    }
  }

  const missing = [];
  for (const c of candidates) {
    const fields = [...c.wheres, ...c.orders];
    const covered = declared.some(idx => indexCovers(idx, fields));
    if (!covered) missing.push(c);
  }

  console.log(`firestore-indexes check: ${candidates.length} composite-query candidates scanned.`);
  if (missing.length === 0) {
    console.log('All composite queries have at least one matching declared index. ✓');
    return;
  }

  console.log(`\n${missing.length} candidates without an obvious matching index (advisory):\n`);
  for (const m of missing) {
    console.log(`  - ${m.file}`);
    console.log(`      ${m.snippet}`);
    if (m.wheres.length) console.log(`      where:    ${m.wheres.join(', ')}`);
    if (m.orders.length) console.log(`      orderBy:  ${m.orders.join(', ')}`);
  }
  console.log(
    '\nThis is advisory — the heuristic is conservative and may flag queries ' +
      'that work fine in prod (e.g. arrayConfig CONTAINS, in / array-contains-any). ' +
      'Review each candidate; declare an index in firestore.indexes.json if needed.',
  );
}

main();
