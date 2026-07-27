#!/usr/bin/env node
/**
 * i18n hardcoded-string audit (#805)
 *
 * Statically scans JSX files for user-facing string literals that are not
 * routed through the i18n module (t('key'), i18n.t('key'), or similar), so
 * new hardcoded strings are caught before merge instead of accumulating
 * silently.
 *
 * Usage:
 *   node scripts/check-i18n-strings.mjs [--dir <path>] [--json] [--write-baseline]
 *
 * By default it fails (exit 1) if any finding is not present in the
 * checked-in baseline (scripts/i18n-strings-baseline.json). This lets the
 * existing backlog of hardcoded strings be paid down incrementally while
 * still blocking *new* hardcoded strings in CI.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import jsx from 'acorn-jsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'i18n-strings-baseline.json');

const Parser = acorn.Parser.extend(jsx());

// Attributes whose string value is user-facing copy (as opposed to CSS
// classes, ids, technical values, etc.).
const TRANSLATABLE_ATTRS = new Set([
  'placeholder',
  'title',
  'alt',
  'aria-label',
  'aria-valuetext',
]);

// Function names whose string-literal arguments are user-facing messages,
// e.g. msg.error('Something went wrong').
const TRANSLATABLE_CALL_METHODS = new Set(['error', 'success', 'warning', 'info']);

function parseArgs(argv) {
  const args = { dir: 'frontend/src/components', json: false, writeBaseline: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') args.dir = argv[++i];
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--write-baseline') args.writeBaseline = true;
  }
  return args;
}

function listJsxFiles(dir) {
  const results = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current)) {
        if (entry === 'node_modules') continue;
        stack.push(path.join(current, entry));
      }
    } else if (/\.jsx$/.test(current) && !/\.(stories|test)\.jsx$/.test(current)) {
      results.push(current);
    }
  }
  return results.sort();
}

// Skip content that isn't meaningfully translatable copy: pure numbers,
// symbols/emoji, single short tokens, asset-code-like all-caps strings, etc.
function looksTranslatable(raw) {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length < 2) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  // Skip short all-caps tokens (asset codes, units): "XLM", "USD", "KB".
  if (/^[A-Z0-9./%-]+$/.test(text) && text.length <= 6) return false;
  // Skip strings that are just punctuation/interpolation leftovers.
  if (/^[-–—•·:.,()[\]{}|/\\!?"'’‘“”\s]+$/.test(text)) return false;
  return true;
}

function findingKey(file, line, text) {
  return `${file}:${line}:${text}`;
}

function scanFile(absPath) {
  const source = readFileSync(absPath, 'utf8');
  const relPath = path.relative(REPO_ROOT, absPath);
  const findings = [];

  let ast;
  try {
    ast = Parser.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch {
    return findings; // Skip files that fail to parse (e.g. TS-only syntax)
  }

  function lineOf(node) {
    return node.loc.start.line;
  }

  function visit(node, parent) {
    if (!node || typeof node.type !== 'string') return;

    if (node.type === 'JSXText') {
      if (looksTranslatable(node.value)) {
        findings.push({ file: relPath, line: lineOf(node), text: node.value.replace(/\s+/g, ' ').trim() });
      }
    }

    if (node.type === 'JSXAttribute' && node.value?.type === 'Literal' && typeof node.value.value === 'string') {
      const attrName = node.name?.name;
      if (TRANSLATABLE_ATTRS.has(attrName) && looksTranslatable(node.value.value)) {
        findings.push({ file: relPath, line: lineOf(node), text: node.value.value.trim() });
      }
    }

    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      TRANSLATABLE_CALL_METHODS.has(node.callee.property?.name) &&
      node.arguments[0]?.type === 'Literal' &&
      typeof node.arguments[0].value === 'string' &&
      looksTranslatable(node.arguments[0].value)
    ) {
      findings.push({ file: relPath, line: lineOf(node.arguments[0]), text: node.arguments[0].value.trim() });
    }

    for (const key in node) {
      if (key === 'loc' || key === 'range' || key === 'parent') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) visit(child, node);
      } else if (value && typeof value.type === 'string') {
        visit(value, node);
      }
    }
  }

  visit(ast, null);
  return findings;
}

function loadBaseline() {
  try {
    return new Set(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')));
  } catch {
    return new Set();
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetDir = path.resolve(REPO_ROOT, args.dir);
  const files = listJsxFiles(targetDir);

  const allFindings = files.flatMap(scanFile);
  const keys = allFindings.map((f) => findingKey(f.file, f.line, f.text));

  if (args.writeBaseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify([...new Set(keys)].sort(), null, 2) + '\n');
    console.log(`Wrote ${keys.length} findings to ${path.relative(REPO_ROOT, BASELINE_PATH)}`);
    return;
  }

  const baseline = loadBaseline();
  const newFindings = allFindings.filter((f, i) => !baseline.has(keys[i]));

  if (args.json) {
    console.log(JSON.stringify({ total: allFindings.length, new: newFindings }, null, 2));
  } else {
    console.log(`i18n string audit: ${allFindings.length} hardcoded string(s) found in ${args.dir} (${baseline.size} in baseline).`);
    if (newFindings.length > 0) {
      console.log(`\n${newFindings.length} NEW hardcoded string(s) not covered by the i18n module:\n`);
      for (const f of newFindings) {
        console.log(`  ${f.file}:${f.line}  "${f.text}"`);
      }
      console.log('\nWrap these in t(\'...\') (or i18n.t(\'...\')) and add the key to all locale files in frontend/src/i18n/locales/,');
      console.log('or, if this really is not user-facing copy, update scripts/i18n-strings-baseline.json via --write-baseline.');
    }
  }

  process.exitCode = newFindings.length > 0 ? 1 : 0;
}

main();
