/**
 * Contract Registry — versioning and breaking change detection.
 *
 * Stores contract snapshots in contracts/logs/ and compares them
 * to detect breaking changes between versions.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACTS_DIR = path.resolve(__dirname, 'pacts');
const LOGS_DIR = path.resolve(__dirname, 'logs');

function loadPact(consumer, provider) {
  const file = path.join(PACTS_DIR, `${consumer}-${provider}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function hashPact(pact) {
  return crypto.createHash('sha256').update(JSON.stringify(pact)).digest('hex');
}

function logPath(consumer, provider, version) {
  return path.join(LOGS_DIR, `${consumer}-${provider}-v${version}.json`);
}

/**
 * Publish a new contract version snapshot.
 * Returns the version number assigned.
 */
export function publishVersion(consumer, provider) {
  const pact = loadPact(consumer, provider);
  if (!pact) throw new Error(`No pact found for ${consumer}-${provider}`);

  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const existing = listVersions(consumer, provider);
  const version = existing.length + 1;
  const entry = { version, publishedAt: new Date().toISOString(), hash: hashPact(pact), pact };

  fs.writeFileSync(logPath(consumer, provider, version), JSON.stringify(entry, null, 2));
  return version;
}

/**
 * List all published versions for a consumer/provider pair.
 */
export function listVersions(consumer, provider) {
  if (!fs.existsSync(LOGS_DIR)) return [];
  return fs
    .readdirSync(LOGS_DIR)
    .filter((f) => f.startsWith(`${consumer}-${provider}-v`) && f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(LOGS_DIR, f), 'utf8')))
    .sort((a, b) => a.version - b.version);
}

/**
 * Detect breaking changes between two contract versions.
 * A breaking change is: an interaction present in `from` that is missing or
 * has a different response shape in `to`.
 *
 * Returns an array of breaking change descriptions (empty = no breaks).
 */
export function detectBreakingChanges(consumer, provider, fromVersion, toVersion) {
  const versions = listVersions(consumer, provider);
  const from = versions.find((v) => v.version === fromVersion);
  const to = versions.find((v) => v.version === toVersion);

  if (!from || !to) throw new Error('Version not found');

  const fromInteractions = from.pact.interactions ?? [];
  const toInteractions = to.pact.interactions ?? [];

  const breaks = [];

  for (const oldI of fromInteractions) {
    const match = toInteractions.find((i) => i.description === oldI.description);
    if (!match) {
      breaks.push(`REMOVED interaction: "${oldI.description}"`);
      continue;
    }
    // Check response status changed
    const oldStatus = oldI.response?.status ?? oldI.willRespondWith?.status;
    const newStatus = match.response?.status ?? match.willRespondWith?.status;
    if (oldStatus !== newStatus) {
      breaks.push(`STATUS CHANGED for "${oldI.description}": ${oldStatus} → ${newStatus}`);
    }
  }

  return breaks;
}
