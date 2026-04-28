#!/usr/bin/env node
/**
 * Cleanup generated test artifacts based on retention days.
 *
 * Default:
 *   - Deletes `test-reports/report-*.{json,html}` older than 30 days.
 *
 * Usage:
 *   node scripts/cleanup-test-artifacts.mjs --days 30 [--dry-run]
 */

import { readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const daysIndex = process.argv.indexOf('--days');
const retentionDays =
  daysIndex !== -1 && process.argv[daysIndex + 1] ? Number(process.argv[daysIndex + 1]) : 30;
const dryRun = args.has('--dry-run');

if (!Number.isFinite(retentionDays) || retentionDays < 0) {
  console.error('Invalid --days value. Example: --days 30');
  process.exit(1);
}

const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
const targets = [{ dir: 'test-reports', fileRegex: /^report-.*\.(json|html)$/ }];

let deleted = 0;
let examined = 0;

for (const { dir, fileRegex } of targets) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    continue;
  }

  for (const entry of entries) {
    if (!fileRegex.test(entry)) continue;
    const fullPath = path.join(dir, entry);
    examined += 1;
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    if (stats.mtimeMs >= cutoffMs) continue;

    if (dryRun) {
      console.log(`[dry-run] delete ${fullPath}`);
      continue;
    }
    try {
      unlinkSync(fullPath);
      deleted += 1;
      console.log(`deleted ${fullPath}`);
    } catch (err) {
      console.warn(`failed to delete ${fullPath}: ${err?.message ?? err}`);
    }
  }
}

console.log(`cleanup complete: examined=${examined} deleted=${deleted} retentionDays=${retentionDays}`);

