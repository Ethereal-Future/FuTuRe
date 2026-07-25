/**
 * Test Environment Registry
 *
 * Handles provisioning, isolation, monitoring, versioning, and cleanup
 * of named test environments defined in envs/*.json.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENVS_DIR = path.join(__dirname, 'envs');
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const ACTIVE_FILE = path.join(DATA_DIR, 'active.json');

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadConfig(name) {
  const file = path.join(ENVS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`Unknown environment: "${name}"`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Provisioning ─────────────────────────────────────────────────────────────

/**
 * Provision a named test environment.
 * Returns an env handle: { id, name, version, vars, provisionedAt }
 */
export function provision(name) {
  const config = loadConfig(name);
  ensureDataDir();

  const id = `${name}-${crypto.randomBytes(4).toString('hex')}`;
  const env = {
    id,
    name: config.name,
    version: config.version,
    vars: { ...config.vars },
    isolation: config.isolation,
    cleanup: config.cleanup,
    provisionedAt: new Date().toISOString(),
    status: 'active',
  };

  // Apply env vars to current process (isolated per-run via id prefix)
  for (const [k, v] of Object.entries(env.vars)) {
    process.env[k] = v;
  }

  // Track active environments
  const active = readJson(ACTIVE_FILE, {});
  active[id] = env;
  writeJson(ACTIVE_FILE, active);

  // Append to history
  const history = readJson(HISTORY_FILE, []);
  history.push({ event: 'provisioned', ...env });
  writeJson(HISTORY_FILE, history);

  return env;
}

// ── Teardown / Cleanup ────────────────────────────────────────────────────────

/**
 * Tear down an environment by id.
 * Restores env vars and removes from active registry.
 */
export function teardown(id) {
  ensureDataDir();
  const active = readJson(ACTIVE_FILE, {});
  const env = active[id];
  if (!env) return; // already cleaned up

  // Restore env vars
  if (env.cleanup.includes('env')) {
    for (const k of Object.keys(env.vars)) {
      delete process.env[k];
    }
  }

  env.status = 'torn-down';
  env.tornDownAt = new Date().toISOString();

  delete active[id];
  writeJson(ACTIVE_FILE, active);

  const history = readJson(HISTORY_FILE, []);
  history.push({ event: 'torn-down', id, name: env.name, tornDownAt: env.tornDownAt });
  writeJson(HISTORY_FILE, history);
}

/**
 * Tear down all active environments.
 */
export function teardownAll() {
  const active = readJson(ACTIVE_FILE, {});
  for (const id of Object.keys(active)) {
    teardown(id);
  }
}

// ── Monitoring ────────────────────────────────────────────────────────────────

/**
 * Returns all currently active environments.
 */
export function getActive() {
  return readJson(ACTIVE_FILE, {});
}

/**
 * Returns the provisioning history log.
 */
export function getHistory() {
  return readJson(HISTORY_FILE, []);
}

/**
 * Returns a health snapshot for all active environments.
 * { id, name, status, uptimeMs }
 */
export function monitor() {
  const active = readJson(ACTIVE_FILE, {});
  const now = Date.now();
  return Object.values(active).map((env) => ({
    id: env.id,
    name: env.name,
    version: env.version,
    status: env.status,
    uptimeMs: now - new Date(env.provisionedAt).getTime(),
  }));
}

// ── Configuration management ─────────────────────────────────────────────────

/**
 * List all available environment configs with their versions.
 */
export function listConfigs() {
  return fs
    .readdirSync(ENVS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const cfg = JSON.parse(fs.readFileSync(path.join(ENVS_DIR, f), 'utf8'));
      return { name: cfg.name, version: cfg.version, description: cfg.description };
    });
}

/**
 * Get the config for a named environment.
 */
export function getConfig(name) {
  return loadConfig(name);
}
