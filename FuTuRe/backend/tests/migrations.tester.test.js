/**
 * Example: Using Migration Tester
 * Demonstrates migration testing procedures
 */

import { describe, it, expect } from 'vitest';
import { createMigrationTester } from '../src/migrations/tester.js';

describe('Migration Tester', () => {
  it('should test migration', async () => {
    const tester = createMigrationTester();

    const migration = {
      name: 'test_migration',
      version: 1,
      up: async (db) => {},
      down: async (db) => {},
    };

    const results = await tester.testMigration(migration);

    expect(results.passed).toBe(true);
    expect(results.tests).toHaveLength(2);
  });

  it('should test migration sequence', async () => {
    const tester = createMigrationTester();

    const migrations = [
      {
        name: 'migration_1',
        version: 1,
        up: async (db) => {},
        down: async (db) => {},
      },
      {
        name: 'migration_2',
        version: 2,
        up: async (db) => {},
        down: async (db) => {},
      },
    ];

    const results = await tester.testMigrationSequence(migrations);

    expect(results.total).toBe(2);
    expect(results.passed).toBe(2);
    expect(results.failed).toBe(0);
  });

  it('should test rollback capability', () => {
    const tester = createMigrationTester();

    const migration = {
      name: 'test_migration',
      version: 1,
      up: async (db) => {},
      down: async (db) => {},
    };

    const results = tester.testRollbackCapability(migration);

    expect(results.canRollback).toBe(true);
    expect(results.downFunctionExists).toBe(true);
  });

  it('should get test summary', async () => {
    const tester = createMigrationTester();

    const migrations = [
      {
        name: 'migration_1',
        version: 1,
        up: async (db) => {},
        down: async (db) => {},
      },
      {
        name: 'migration_2',
        version: 2,
        up: async (db) => {},
        down: async (db) => {},
      },
    ];

    await tester.testMigrationSequence(migrations);

    const summary = tester.getSummary();

    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(0);
  });
});
