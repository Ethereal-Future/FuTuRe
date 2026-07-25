#!/usr/bin/env node
/**
 * Migration Test Script
 * Runs all migrations from scratch, rolls them back, and verifies schema state.
 */

import { createMigrationFramework } from '../backend/src/migrations/framework.js';

// Simulated schema state (stands in for a real DB connection in this project)
const mockDb = {
  tables: {},
  query(sql) {
    return { rows: [], rowCount: 0 };
  },
};

const MIGRATIONS = [
  {
    name: 'create_accounts',
    version: 1,
    up: async (db) => {
      db.tables['accounts'] = { columns: ['id', 'stellar_address', 'created_at'], indexes: ['stellar_address'] };
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
        indexes: ['from_address', 'created_at'],
      };
    },
    down: async (db) => {
      delete db.tables['transactions'];
    },
  },
  {
    name: 'create_audit_log',
    version: 3,
    up: async (db) => {
      db.tables['audit_log'] = { columns: ['id', 'action', 'actor', 'timestamp'], indexes: [] };
    },
    down: async (db) => {
      delete db.tables['audit_log'];
    },
  },
];

const EXPECTED_SCHEMA = {
  tables: ['accounts', 'transactions', 'audit_log'],
};

async function run() {
  console.log('=== Migration Test: Run from scratch ===');
  const framework = createMigrationFramework(mockDb);
  framework.currentVersion = 0;

  for (const m of MIGRATIONS) {
    framework.registerMigration(m.name, m.version, m.up, m.down);
  }

  // 1. Apply all migrations
  const applyResults = await framework.migrate();
  for (const r of applyResults) {
    console.log(`  [${r.status}] ${r.name} (v${r.version})`);
    if (r.status !== 'success') {
      console.error(`FAIL: migration ${r.name} did not succeed`);
      process.exit(1);
    }
  }

  // 2. Verify schema matches expected
  console.log('\n=== Schema Verification (post-migrate) ===');
  for (const table of EXPECTED_SCHEMA.tables) {
    if (!mockDb.tables[table]) {
      console.error(`FAIL: expected table '${table}' not found`);
      process.exit(1);
    }
    console.log(`  [OK] table '${table}' exists`);
  }

  // 3. Rollback all migrations
  console.log('\n=== Rollback all migrations ===');
  const rollbackResults = await framework.rollback(MIGRATIONS.length);
  for (const r of rollbackResults) {
    console.log(`  [${r.status}] ${r.name} (v${r.version})`);
    if (r.status !== 'rolled_back') {
      console.error(`FAIL: rollback of ${r.name} did not succeed`);
      process.exit(1);
    }
  }

  // 4. Verify schema is clean after rollback
  console.log('\n=== Schema Verification (post-rollback) ===');
  const remainingTables = Object.keys(mockDb.tables);
  if (remainingTables.length !== 0) {
    console.error(`FAIL: expected empty schema after rollback, found: ${remainingTables.join(', ')}`);
    process.exit(1);
  }
  console.log('  [OK] schema is clean after full rollback');

  console.log('\n✅ All migration tests passed.');
}

run().catch((err) => {
  console.error('Migration test error:', err);
  process.exit(1);
});
