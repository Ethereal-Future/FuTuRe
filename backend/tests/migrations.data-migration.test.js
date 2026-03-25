/**
 * Example: Using Data Migration
 * Demonstrates data transformation during migrations
 */

import { describe, it, expect } from 'vitest';
import { createDataMigration } from '../src/migrations/data-migration.js';

describe('Data Migration', () => {
  it('should create data migration', () => {
    const migration = createDataMigration('transform_users', 1);

    expect(migration).toBeDefined();
    expect(migration.migration).toBeDefined();
  });

  it('should add column transformation', () => {
    const migration = createDataMigration('add_status', 1).addColumnTransform('users', 'status', async (db, table) => {
      return { updated: true };
    });

    expect(migration.migration.transformations).toHaveLength(1);
  });

  it('should add batch transformation', () => {
    const migration = createDataMigration('batch_update', 1).addBatchTransform('users', 100, async (db, table) => {
      return { processed: true };
    });

    expect(migration.migration.transformations).toHaveLength(1);
  });

  it('should execute data migration', async () => {
    const migration = createDataMigration('test_migration', 1)
      .addColumnTransform('users', 'email', async (db, table) => {
        return { transformed: true };
      })
      .build();

    const results = await migration.execute({});

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');
  });

  it('should rollback data migration', async () => {
    const migration = createDataMigration('test_migration', 1)
      .addColumnTransform('users', 'email', async (db, table) => {
        return { transformed: true };
      })
      .build();

    const results = await migration.rollback({});

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('rolled_back');
  });
});
