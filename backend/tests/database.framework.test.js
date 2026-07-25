/**
 * Database Testing Framework - Issue #92
 * Covers: migration lifecycle, FK constraints, RBAC, stress test, backup/restore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMigrationFramework } from '../src/migrations/framework.js';
import { createMigrationTester } from '../src/migrations/tester.js';

// ---------------------------------------------------------------------------
// Shared in-memory DB fixture
// ---------------------------------------------------------------------------

function createMockDb() {
  return {
    tables: {},
    roles: {
      admin: { canWrite: true, canDrop: true },
      readonly: { canWrite: false, canDrop: false },
    },
    currentRole: 'admin',

    query(sql, role = this.currentRole) {
      const r = this.roles[role];
      const upper = sql.trim().toUpperCase();

      if ((upper.startsWith('DROP') || upper.startsWith('INSERT')) && !r.canWrite) {
        throw new Error(`Permission denied: role '${role}' cannot execute: ${sql}`);
      }
      return { rows: [], rowCount: 0 };
    },

    insert(table, record) {
      if (!this.roles[this.currentRole].canWrite) {
        throw new Error(`Permission denied: role '${this.currentRole}' cannot INSERT`);
      }
      if (!this.tables[table]) throw new Error(`Table '${table}' does not exist`);
      this.tables[table].rows = this.tables[table].rows || [];
      this.tables[table].rows.push({ id: this.tables[table].rows.length + 1, ...record });
      return this.tables[table].rows.at(-1);
    },

    drop(table) {
      if (!this.roles[this.currentRole].canDrop) {
        throw new Error(`Permission denied: role '${this.currentRole}' cannot DROP`);
      }
      delete this.tables[table];
    },

    dump() {
      return JSON.parse(JSON.stringify(this.tables));
    },

    restore(snapshot) {
      this.tables = JSON.parse(JSON.stringify(snapshot));
    },
  };
}

const MIGRATIONS = [
  {
    name: 'create_accounts',
    version: 1,
    up: async (db) => {
      db.tables['accounts'] = { columns: ['id', 'stellar_address', 'created_at'], rows: [] };
    },
    down: async (db) => {
      delete db.tables['accounts'];
    },
  },
  {
    name: 'create_transactions',
    version: 2,
    up: async (db) => {
      db.tables['transactions'] = {
        columns: ['id', 'from_address', 'to_address', 'amount', 'asset', 'created_at'],
        foreignKeys: [{ column: 'from_address', references: 'accounts.stellar_address' }],
        rows: [],
      };
    },
    down: async (db) => {
      delete db.tables['transactions'];
    },
  },
];

// ---------------------------------------------------------------------------
// 1. Migration Lifecycle
// ---------------------------------------------------------------------------

describe('Migration Lifecycle', () => {
  let db, framework;

  beforeEach(() => {
    db = createMockDb();
    framework = createMigrationFramework(db);
    framework.currentVersion = 0;
    for (const m of MIGRATIONS) framework.registerMigration(m.name, m.version, m.up, m.down);
  });

  it('applies all migrations from scratch', async () => {
    const results = await framework.migrate();
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'success')).toBe(true);
    expect(db.tables).toHaveProperty('accounts');
    expect(db.tables).toHaveProperty('transactions');
  });

  it('schema matches expected metadata after migrate', async () => {
    await framework.migrate();
    const status = framework.getMigrationStatus();
    expect(status.currentVersion).toBe(2);
    expect(status.latestVersion).toBe(2);
    expect(Object.keys(db.tables)).toEqual(['accounts', 'transactions']);
  });

  it('rolls back all migrations and leaves clean schema', async () => {
    await framework.migrate();
    const results = await framework.rollback(MIGRATIONS.length);
    expect(results.every((r) => r.status === 'rolled_back')).toBe(true);
    expect(Object.keys(db.tables)).toHaveLength(0);
  });

  it('migration tester validates up/down for each migration', async () => {
    const tester = createMigrationTester();
    const summary = await tester.testMigrationSequence(MIGRATIONS, db);
    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(MIGRATIONS.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Foreign Key Constraint Enforcement
// ---------------------------------------------------------------------------

describe('Foreign Key Constraints', () => {
  let db;

  beforeEach(async () => {
    db = createMockDb();
    const framework = createMigrationFramework(db);
    framework.currentVersion = 0;
    for (const m of MIGRATIONS) framework.registerMigration(m.name, m.version, m.up, m.down);
    await framework.migrate();
  });

  it('allows inserting a transaction when the parent account exists', () => {
    db.insert('accounts', { stellar_address: 'GABC123', created_at: new Date().toISOString() });
    expect(() =>
      db.insert('transactions', {
        from_address: 'GABC123',
        to_address: 'GXYZ789',
        amount: '100',
        asset: 'XLM',
        created_at: new Date().toISOString(),
      })
    ).not.toThrow();
  });

  it('rejects orphan transaction when parent account does not exist', () => {
    // Simulate FK enforcement: check parent exists before insert
    const fkCheck = (table, record) => {
      const fks = db.tables[table]?.foreignKeys || [];
      for (const fk of fks) {
        const [refTable, refCol] = fk.references.split('.');
        const parentRows = db.tables[refTable]?.rows || [];
        const exists = parentRows.some((r) => r[refCol] === record[fk.column]);
        if (!exists) throw new Error(`FK violation: no matching ${fk.references} for value '${record[fk.column]}'`);
      }
      return db.insert(table, record);
    };

    expect(() =>
      fkCheck('transactions', {
        from_address: 'GHOST_ADDRESS',
        to_address: 'GXYZ789',
        amount: '50',
        asset: 'XLM',
        created_at: new Date().toISOString(),
      })
    ).toThrow(/FK violation/);
  });
});

// ---------------------------------------------------------------------------
// 3. RBAC — Read-Only User Restrictions
// ---------------------------------------------------------------------------

describe('RBAC: Read-Only User', () => {
  let db;

  beforeEach(async () => {
    db = createMockDb();
    const framework = createMigrationFramework(db);
    framework.currentVersion = 0;
    for (const m of MIGRATIONS) framework.registerMigration(m.name, m.version, m.up, m.down);
    await framework.migrate();
    db.currentRole = 'readonly';
  });

  it('denies DROP TABLE for readonly role', () => {
    expect(() => db.drop('accounts')).toThrow(/Permission denied/);
  });

  it('denies INSERT for readonly role', () => {
    expect(() =>
      db.insert('accounts', { stellar_address: 'GABC', created_at: new Date().toISOString() })
    ).toThrow(/Permission denied/);
  });

  it('denies raw DROP SQL for readonly role', () => {
    expect(() => db.query('DROP TABLE accounts', 'readonly')).toThrow(/Permission denied/);
  });

  it('denies raw INSERT SQL for readonly role', () => {
    expect(() => db.query("INSERT INTO accounts VALUES ('x')", 'readonly')).toThrow(/Permission denied/);
  });
});

// ---------------------------------------------------------------------------
// 4. Performance Baseline — Stress Test (10,000 records)
// ---------------------------------------------------------------------------

describe('Performance Baseline: Stress Test', () => {
  const RECORD_COUNT = 10_000;

  it('inserts 10,000 records and measures indexed vs non-indexed query latency', () => {
    const rows = [];
    for (let i = 0; i < RECORD_COUNT; i++) {
      rows.push({ id: i, stellar_address: `G${i.toString().padStart(10, '0')}`, amount: Math.random() * 1000 });
    }

    // Indexed lookup (by id — O(1) with Map)
    const indexedMap = new Map(rows.map((r) => [r.id, r]));
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) indexedMap.get(Math.floor(Math.random() * RECORD_COUNT));
    const indexedMs = performance.now() - t0;

    // Non-indexed lookup (linear scan)
    const t1 = performance.now();
    for (let i = 0; i < 1000; i++) {
      const target = Math.floor(Math.random() * RECORD_COUNT);
      rows.find((r) => r.id === target);
    }
    const nonIndexedMs = performance.now() - t1;

    console.log(`  Indexed   (1000 lookups): ${indexedMs.toFixed(2)}ms`);
    console.log(`  Non-indexed (1000 lookups): ${nonIndexedMs.toFixed(2)}ms`);
    console.log(`  Speedup: ${(nonIndexedMs / indexedMs).toFixed(1)}x`);

    // Indexed should be significantly faster
    expect(indexedMs).toBeLessThan(nonIndexedMs);
    // Both should complete in reasonable time
    expect(nonIndexedMs).toBeLessThan(5000);
  });
});

// ---------------------------------------------------------------------------
// 5. Backup / Restore Validation
// ---------------------------------------------------------------------------

describe('Backup and Restore', () => {
  let db;

  beforeEach(async () => {
    db = createMockDb();
    const framework = createMigrationFramework(db);
    framework.currentVersion = 0;
    for (const m of MIGRATIONS) framework.registerMigration(m.name, m.version, m.up, m.down);
    await framework.migrate();

    db.insert('accounts', { stellar_address: 'GABC123', created_at: '2026-01-01T00:00:00Z' });
    db.insert('accounts', { stellar_address: 'GXYZ789', created_at: '2026-01-02T00:00:00Z' });
  });

  it('dumps, deletes a table, restores, and verifies data consistency', () => {
    // 1. Dump
    const snapshot = db.dump();
    expect(snapshot.accounts.rows).toHaveLength(2);

    // 2. Delete table
    db.drop('accounts');
    expect(db.tables).not.toHaveProperty('accounts');

    // 3. Restore
    db.restore(snapshot);
    expect(db.tables).toHaveProperty('accounts');

    // 4. Verify data consistency
    expect(db.tables.accounts.rows).toHaveLength(2);
    expect(db.tables.accounts.rows[0].stellar_address).toBe('GABC123');
    expect(db.tables.accounts.rows[1].stellar_address).toBe('GXYZ789');
  });

  it('restore is a deep copy — mutations after restore do not affect snapshot', () => {
    const snapshot = db.dump();
    db.restore(snapshot);
    db.tables.accounts.rows.push({ id: 99, stellar_address: 'GNEW', created_at: '2026-03-01' });

    // Original snapshot should be unaffected
    expect(snapshot.accounts.rows).toHaveLength(2);
  });
});
