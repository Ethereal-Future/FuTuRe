/**
 * Example: Using Schema Version Tracker
 * Demonstrates version tracking and history
 */

import { describe, it, expect } from 'vitest';
import { createSchemaVersionTracker } from '../src/migrations/version-tracker.js';

describe('Schema Version Tracker', () => {
  it('should add version', () => {
    const tracker = createSchemaVersionTracker();
    tracker.versions = [];

    tracker.addVersion('create_users', 1, 'Create users table');

    expect(tracker.versions).toHaveLength(1);
    expect(tracker.versions[0].version).toBe(1);
  });

  it('should mark version as applied', () => {
    const tracker = createSchemaVersionTracker();
    tracker.versions = [];

    tracker.addVersion('migration_1', 1);
    tracker.markApplied(1);

    const version = tracker.getVersion(1);
    expect(version.status).toBe('applied');
    expect(version).toHaveProperty('appliedAt');
  });

  it('should get current version', () => {
    const tracker = createSchemaVersionTracker();
    tracker.versions = [];

    tracker.addVersion('migration_1', 1);
    tracker.addVersion('migration_2', 2);
    tracker.markApplied(1);
    tracker.markApplied(2);

    expect(tracker.getCurrentVersion()).toBe(2);
  });

  it('should get version history', () => {
    const tracker = createSchemaVersionTracker();
    tracker.versions = [];

    tracker.addVersion('migration_1', 1);
    tracker.addVersion('migration_2', 2);

    const history = tracker.getHistory();

    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0].version).toBe(1);
  });

  it('should mark version as rolled back', () => {
    const tracker = createSchemaVersionTracker();
    tracker.versions = [];

    tracker.addVersion('migration_1', 1);
    tracker.markApplied(1);
    tracker.markRolledBack(1);

    const version = tracker.getVersion(1);
    expect(version.status).toBe('rolled_back');
    expect(version).toHaveProperty('rolledBackAt');
  });
});
