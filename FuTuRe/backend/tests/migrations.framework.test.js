/**
 * Example: Using Migration Framework
 * Demonstrates basic migration setup and execution
 */

import { describe, it, expect } from 'vitest';
import { createMigrationFramework } from '../src/migrations/framework.js';

describe('Migration Framework', () => {
  it('should register migrations', () => {
    const framework = createMigrationFramework();

    framework.registerMigration('create_users_table', 1, async (db) => {}, async (db) => {});

    framework.registerMigration('add_email_column', 2, async (db) => {}, async (db) => {});

    expect(framework.migrations).toHaveLength(2);
    expect(framework.migrations[0].version).toBe(1);
    expect(framework.migrations[1].version).toBe(2);
  });

  it('should get migration status', () => {
    const framework = createMigrationFramework();

    framework.registerMigration('migration_1', 1, async (db) => {}, async (db) => {});
    framework.registerMigration('migration_2', 2, async (db) => {}, async (db) => {});

    const status = framework.getMigrationStatus();

    expect(status).toHaveProperty('currentVersion');
    expect(status).toHaveProperty('latestVersion');
    expect(status).toHaveProperty('migrations');
  });

  it('should get pending migrations', () => {
    const framework = createMigrationFramework();

    framework.registerMigration('migration_1', 1, async (db) => {}, async (db) => {});
    framework.registerMigration('migration_2', 2, async (db) => {}, async (db) => {});

    const pending = framework.getPendingMigrations();

    expect(pending.length).toBeGreaterThan(0);
  });

  it('should execute migrations', async () => {
    const framework = createMigrationFramework();
    let upCalled = false;

    framework.registerMigration(
      'test_migration',
      1,
      async (db) => {
        upCalled = true;
      },
      async (db) => {}
    );

    const results = await framework.migrate(1);

    expect(upCalled).toBe(true);
    expect(results[0].status).toBe('success');
  });

  it('should rollback migrations', async () => {
    const framework = createMigrationFramework();
    let downCalled = false;

    framework.registerMigration(
      'test_migration',
      1,
      async (db) => {},
      async (db) => {
        downCalled = true;
      }
    );

    framework.currentVersion = 1;
    const results = await framework.rollback(1);

    expect(downCalled).toBe(true);
    expect(results[0].status).toBe('rolled_back');
  });
});
