#!/usr/bin/env node
/**
 * scripts/check-unwired-modules.js
 *
 * CI check for Issue #1126: detect JS modules under backend/src that export
 * at least one symbol but have zero callers anywhere in the rest of the
 * application (i.e. no file outside the module itself imports / requires it).
 *
 * Usage:
 *   node scripts/check-unwired-modules.js [--src <dir>] [--ignore <glob>]
 *
 * Exit codes:
 *   0 — all exported modules have at least one caller
 *   1 — one or more zero-caller modules were found (CI failure)
 *
 * How it works
 * ─────────────
 * 1. Recursively collect every *.js file under --src (default: backend/src).
 * 2. For each file, decide whether it is "exported": it must contain at least
 *    one `export` statement (ES module) or a `module.exports` assignment.
 * 3. For each exported file, search all OTHER source files (plus tests under
 *    backend/tests, scripts/, and route/server entry points) for any string
 *    that looks like an import of that file (by relative path stem or by the
 *    absolute-path stem portion after backend/src/).
 * 4. Report modules with zero hits as "unwired".
 *
 * Limitations / known false-positives
 * ─────────────────────────────────────
 * - Dynamic imports constructed at runtime (`import(variable)`) are not
 *   detected.  This is intentional — dynamic imports are rare in this
 *   codebase, and a false-negative (a module incorrectly passed) is better
 *   than a false-positive that blocks CI on valid code.
 * - Index files (index.js) that re-export from a directory are treated as
 *   callers of every file they re-export.
 * - The --ignore glob list lets you exclude experimental/proposal directories
 *   from the check.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve, basename, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let srcDir = join(ROOT, 'backend', 'src');
const ignoredDirs = new Set(['node_modules', '.git', 'dist', 'build', 'experimental', 'proposals']);

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--src' && args[i + 1]) {
    srcDir = resolve(args[++i]);
  }
  if (args[i] === '--ignore' && args[i + 1]) {
    ignoredDirs.add(args[++i]);
  }
}

// ── File helpers ──────────────────────────────────────────────────────────────

/**
 * Recursively collect all .js files under `dir`, skipping ignored directories.
 * @param {string} dir
 * @returns {string[]} absolute paths
 */
function collectJsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectJsFiles(full));
    } else if (stat.isFile() && extname(entry) === '.js') {
      results.push(full);
    }
  }
  return results;
}

/**
 * Return true if the file contains at least one ES `export` statement or a
 * CommonJS `module.exports` assignment — i.e. it is a module that exposes a
 * public API.
 * @param {string} content
 */
function hasExports(content) {
  return (
    /^\s*export\s+(default|class|function|const|let|var|async|\{|\*)/m.test(content) ||
    /module\.exports\s*=/m.test(content)
  );
}

/**
 * Build the set of string patterns that, when found in another file, count as
 * an import of `filePath`.
 *
 * We look for:
 *  - The relative path stem (e.g. `./eventStore` or `../eventSourcing/eventStore`)
 *  - The src-relative path stem (e.g. `eventSourcing/eventStore`)
 *  - The bare filename stem (e.g. `eventStore`)
 *
 * @param {string} filePath
 * @returns {string[]}
 */
function importPatterns(filePath) {
  const stem = basename(filePath, '.js');
  const srcRelative = relative(srcDir, filePath).replace(/\.js$/, '');

  return [
    // Match any quote/backtick followed by a path ending in the stem
    // e.g. from '../db/sharding' or from './sharding'
    `/${stem}['"\`]`,
    `/${stem}.js['"\`]`,
    // Also match the src-relative path for index barrel re-exports
    `'${srcRelative}'`,
    `"${srcRelative}"`,
    `\`${srcRelative}\``,
    `'${srcRelative}.js'`,
    `"${srcRelative}.js"`,
  ];
}

// ── Gather search corpus ──────────────────────────────────────────────────────
// Include backend/src, backend/tests, and top-level scripts

const srcFiles = collectJsFiles(srcDir);

const testDir = join(ROOT, 'backend', 'tests');
const testFiles = collectJsFiles(testDir);

const scriptsDir = join(ROOT, 'scripts');
const scriptFiles = collectJsFiles(scriptsDir);

const serverFile = join(ROOT, 'backend', 'src', 'server.js');

const allSearchFiles = [...testFiles, ...scriptFiles, serverFile].filter((f) => {
  try { statSync(f); return true; } catch { return false; }
});

// Pre-load all search-file content so we only read each file once
/** @type {Map<string, string>} */
const searchContents = new Map();
for (const f of allSearchFiles) {
  try {
    searchContents.set(f, readFileSync(f, 'utf8'));
  } catch { /* skip unreadable */ }
}

// Also include all other src files in the search corpus
for (const f of srcFiles) {
  if (!searchContents.has(f)) {
    try {
      searchContents.set(f, readFileSync(f, 'utf8'));
    } catch { /* skip */ }
  }
}

// ── Main scan ─────────────────────────────────────────────────────────────────

const unwired = [];

for (const filePath of srcFiles) {
  // Skip index files — their purpose IS to re-export, they are never directly
  // imported by name in a way that would show up as a self-reference.
  if (basename(filePath) === 'index.js') continue;

  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    continue;
  }

  if (!hasExports(content)) continue; // not an exported module

  const patterns = importPatterns(filePath);
  let callerCount = 0;

  for (const [searchPath, searchContent] of searchContents.entries()) {
    if (searchPath === filePath) continue; // don't count self-references

    for (const pattern of patterns) {
      if (searchContent.includes(pattern.replace(/\['"` \]$/,'').replace(/^\//,'/'))) {
        // Use a simple string search rather than regex to avoid escaping issues
        // Check each pattern variant
        callerCount++;
        break;
      }
    }
    if (callerCount > 0) break;
  }

  if (callerCount === 0) {
    unwired.push(relative(ROOT, filePath));
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

if (unwired.length === 0) {
  console.log('✅  check-unwired-modules: all exported modules have at least one caller.');
  process.exit(0);
} else {
  console.error('❌  check-unwired-modules: the following exported modules have zero callers:\n');
  for (const f of unwired) {
    console.error(`   ${f}`);
  }
  console.error(
    '\nFix: either import these modules from an active code path, move them to' +
    ' backend/experimental/, or delete them if they are no longer needed.\n'
  );
  process.exit(1);
}
