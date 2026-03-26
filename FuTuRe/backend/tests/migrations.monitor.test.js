/**
 * Example: Using Migration Monitor
 * Demonstrates migration execution monitoring
 */

import { describe, it, expect } from 'vitest';
import { createMigrationMonitor } from '../src/migrations/monitor.js';

describe('Migration Monitor', () => {
  it('should log migration', () => {
    const monitor = createMigrationMonitor();

    monitor.logMigration('test_migration', 1, 'success', 100);

    expect(monitor.logs).toHaveLength(1);
    expect(monitor.logs[0].name).toBe('test_migration');
  });

  it('should get execution history', () => {
    const monitor = createMigrationMonitor();

    monitor.logMigration('migration_1', 1, 'success', 50);
    monitor.logMigration('migration_2', 2, 'success', 75);
    monitor.logMigration('migration_3', 3, 'success', 100);

    const history = monitor.getExecutionHistory(2);

    expect(history).toHaveLength(2);
    expect(history[0].version).toBe(3);
  });

  it('should get statistics', () => {
    const monitor = createMigrationMonitor();

    monitor.logMigration('migration_1', 1, 'success', 50);
    monitor.logMigration('migration_2', 2, 'success', 75);
    monitor.logMigration('migration_3', 3, 'failed', 100);

    const stats = monitor.getStatistics();

    expect(stats.total).toBe(3);
    expect(stats.successful).toBe(2);
    expect(stats.failed).toBe(1);
  });

  it('should get migration log by version', () => {
    const monitor = createMigrationMonitor();

    monitor.logMigration('migration_1', 1, 'success', 50);
    monitor.logMigration('migration_1_retry', 1, 'success', 75);

    const logs = monitor.getMigrationLog(1);

    expect(logs).toHaveLength(2);
  });
});
