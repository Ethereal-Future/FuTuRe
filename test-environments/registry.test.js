/**
 * Tests for the test environment registry and data manager.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { provision, teardown, teardownAll, getActive, monitor, listConfigs, getHistory } from './registry.js';
import { getSeedData, seedStore, clearStore } from './data-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

afterEach(() => {
  teardownAll();
  // Clean up data files written during tests
  ['active.json', 'history.json'].forEach((f) => {
    const p = path.join(DATA_DIR, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
});

// ── Provisioning ──────────────────────────────────────────────────────────────

describe('provision', () => {
  it('returns an env handle with id, name, version, vars', () => {
    const env = provision('unit');
    expect(env.id).toMatch(/^unit-[0-9a-f]{8}$/);
    expect(env.name).toBe('unit');
    expect(env.version).toBe('1.0.0');
    expect(env.vars).toHaveProperty('NODE_ENV', 'test');
  });

  it('applies vars to process.env', () => {
    provision('unit');
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.LOG_LEVEL).toBe('silent');
  });

  it('registers the env as active', () => {
    const env = provision('unit');
    const active = getActive();
    expect(active[env.id]).toBeDefined();
    expect(active[env.id].status).toBe('active');
  });

  it('throws for unknown environment names', () => {
    expect(() => provision('nonexistent')).toThrow('Unknown environment');
  });

  it('can provision multiple environments independently', () => {
    const a = provision('unit');
    const b = provision('integration');
    expect(a.id).not.toBe(b.id);
    expect(Object.keys(getActive())).toHaveLength(2);
  });
});

// ── Teardown ──────────────────────────────────────────────────────────────────

describe('teardown', () => {
  it('removes the env from active registry', () => {
    const env = provision('unit');
    teardown(env.id);
    expect(getActive()[env.id]).toBeUndefined();
  });

  it('restores env vars', () => {
    const env = provision('unit');
    teardown(env.id);
    expect(process.env.LOG_LEVEL).toBeUndefined();
  });

  it('is idempotent — calling twice does not throw', () => {
    const env = provision('unit');
    teardown(env.id);
    expect(() => teardown(env.id)).not.toThrow();
  });
});

describe('teardownAll', () => {
  it('cleans up all active environments', () => {
    provision('unit');
    provision('integration');
    teardownAll();
    expect(Object.keys(getActive())).toHaveLength(0);
  });
});

// ── Monitoring ────────────────────────────────────────────────────────────────

describe('monitor', () => {
  it('returns a snapshot with uptimeMs for each active env', () => {
    provision('unit');
    const snapshot = monitor();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toHaveProperty('uptimeMs');
    expect(snapshot[0].uptimeMs).toBeGreaterThanOrEqual(0);
    expect(snapshot[0].status).toBe('active');
  });

  it('returns empty array when no environments are active', () => {
    expect(monitor()).toHaveLength(0);
  });
});

// ── History / Versioning ──────────────────────────────────────────────────────

describe('history', () => {
  it('records provisioned and torn-down events', () => {
    const env = provision('unit');
    teardown(env.id);
    const history = getHistory();
    const events = history.map((e) => e.event);
    expect(events).toContain('provisioned');
    expect(events).toContain('torn-down');
  });
});

// ── Config management ─────────────────────────────────────────────────────────

describe('listConfigs', () => {
  it('returns all available environment configs', () => {
    const configs = listConfigs();
    const names = configs.map((c) => c.name);
    expect(names).toContain('unit');
    expect(names).toContain('integration');
    expect(names).toContain('e2e');
    expect(names).toContain('performance');
  });

  it('each config has name, version, description', () => {
    listConfigs().forEach((c) => {
      expect(c).toHaveProperty('name');
      expect(c).toHaveProperty('version');
      expect(c).toHaveProperty('description');
    });
  });
});

// ── Data Manager ──────────────────────────────────────────────────────────────

describe('getSeedData', () => {
  it('returns accounts and assets for each environment', () => {
    for (const name of ['unit', 'integration', 'e2e', 'performance']) {
      const data = getSeedData(name);
      expect(Array.isArray(data.accounts)).toBe(true);
      expect(Array.isArray(data.assets)).toBe(true);
      expect(data.accounts.length).toBeGreaterThan(0);
    }
  });

  it('returns empty data for unknown environments', () => {
    const data = getSeedData('unknown');
    expect(data.accounts).toHaveLength(0);
  });
});

describe('seedStore / clearStore', () => {
  it('seeds a store with environment data', () => {
    const store = seedStore('integration');
    expect(store.accounts.length).toBeGreaterThan(0);
    expect(store.assets).toContain('XLM');
    expect(store.seededAt).toBeTruthy();
  });

  it('clearStore empties the store', () => {
    const store = seedStore('integration');
    clearStore(store);
    expect(store.accounts).toHaveLength(0);
    expect(store.seededAt).toBeNull();
  });

  it('seedStore does not mutate the original seed data', () => {
    const store = seedStore('unit');
    store.accounts.push({ publicKey: 'EXTRA', balance: '0' });
    const fresh = seedStore('unit');
    expect(fresh.accounts).toHaveLength(1); // original unchanged
  });
});
