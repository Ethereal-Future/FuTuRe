#!/usr/bin/env node
/**
 * PII / Secrets scan (tracked files)
 *
 * Goal: prevent committing real secrets/PII into tests, fixtures, docs, reports.
 *
 * Usage:
 *   node scripts/pii-scan.mjs
 *
 * Optional env:
 *   PII_SCAN_IGNORE="path/substring,other/substr"
 */

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const STELLAR_SECRET_KEY_REGEX = /\bS[A-Z2-7]{55}\b/g;
const JWT_REGEX = /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g;
const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

const ALLOWED_EMAIL_DOMAINS = new Set(['example.com', 'example.org', 'example.net']);

const SKIP_EXACT = new Set([
  'package-lock.json',
  'backend/package-lock.json',
  'frontend/package-lock.json',
]);

const ALLOWED_EXTS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.txt',
  '.env',
  '.html',
  '.css',
]);

const ignoreSubstrings = (process.env.PII_SCAN_IGNORE ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function shouldSkipFile(filePath) {
  if (SKIP_EXACT.has(filePath)) return true;
  if (filePath.startsWith('.git/')) return true;
  if (filePath.includes('/node_modules/')) return true;
  if (filePath.includes('/dist/')) return true;
  if (filePath.includes('/coverage/')) return true;
  if (!ALLOWED_EXTS.has(path.extname(filePath))) return true;
  if (ignoreSubstrings.some((sub) => filePath.includes(sub))) return true;
  return false;
}

function safeLineCol(text, index) {
  const upTo = text.slice(0, index);
  const lines = upTo.split('\n');
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  return { line, col };
}

function redactValue(type, value) {
  if (!value) return value;
  if (type === 'stellar_secret') return `${value.slice(0, 4)}…${value.slice(-4)}`;
  if (type === 'jwt') return `${value.slice(0, 10)}…${value.slice(-6)}`;
  if (type === 'email') {
    const [user, domain] = value.split('@');
    const redactedUser = user.length <= 2 ? '*' : `${user[0]}***${user[user.length - 1]}`;
    return `${redactedUser}@${domain}`;
  }
  return '[REDACTED]';
}

function scanWithRegex(text, regex, type, { allowMatch } = {}) {
  const findings = [];
  for (const match of text.matchAll(regex)) {
    const value = match[0];
    if (allowMatch && !allowMatch(value)) continue;
    const index = match.index ?? -1;
    findings.push({ type, value, index });
  }
  return findings;
}

function listTrackedFiles() {
  try {
    const out = execSync('git ls-files', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    // Fallback: walk common project roots.
    const roots = ['README.md', 'TESTING.md', 'backend', 'frontend', 'testing', 'docs', 'scripts'];
    const files = [];
    const stack = [...roots];

    while (stack.length) {
      const current = stack.pop();
      if (!current) continue;
      let stats;
      try {
        stats = statSync(current);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        if (current === '.git' || current.includes('/node_modules')) continue;
        let entries = [];
        try {
          entries = readdirSync(current);
        } catch {
          continue;
        }
        for (const entry of entries) stack.push(path.join(current, entry));
        continue;
      }
      if (stats.isFile()) files.push(current);
    }

    return files;
  }
}

function isAllowedEmail(value) {
  const at = value.lastIndexOf('@');
  if (at === -1) return false;
  const domain = value.slice(at + 1).toLowerCase();
  return ALLOWED_EMAIL_DOMAINS.has(domain);
}

function scanFile(filePath) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  return [
    ...scanWithRegex(text, STELLAR_SECRET_KEY_REGEX, 'stellar_secret'),
    ...scanWithRegex(text, JWT_REGEX, 'jwt'),
    ...scanWithRegex(text, EMAIL_REGEX, 'email', { allowMatch: (v) => !isAllowedEmail(v) }),
  ].map((f) => ({
    ...f,
    filePath,
    ...safeLineCol(text, Math.max(0, f.index)),
  }));
}

function main() {
  const candidates = listTrackedFiles();
  const files = candidates.filter((p) => !shouldSkipFile(p));

  const findings = [];
  for (const filePath of files) {
    findings.push(...scanFile(filePath));
  }

  if (findings.length === 0) {
    console.log('✅ PII scan passed (no secrets/PII detected in tracked files).');
    return;
  }

  console.error(`❌ PII scan failed: ${findings.length} finding(s).`);
  for (const f of findings.slice(0, 50)) {
    const shown = redactValue(f.type, f.value);
    console.error(`- ${f.filePath}:${f.line}:${f.col} [${f.type}] ${shown}`);
  }
  if (findings.length > 50) {
    console.error(`…and ${findings.length - 50} more.`);
  }

  process.exitCode = 1;
}

main();
