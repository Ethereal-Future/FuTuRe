/**
 * Example: Using Migration Validator
 * Demonstrates migration validation
 */

import { describe, it, expect } from 'vitest';
import { createMigrationValidator } from '../src/migrations/validator.js';

describe('Migration Validator', () => {
  it('should validate valid migration', () => {
    const validator = createMigrationValidator();

    const migration = {
      name: 'test_migration',
      version: 1,
      up: async (db) => {},
      down: async (db) => {},
    };

    const isValid = validator.validateMigration(migration);

    expect(isValid).toBe(true);
    expect(validator.getErrors()).toHaveLength(0);
  });

  it('should reject migration without name', () => {
    const validator = createMigrationValidator();

    const migration = {
      version: 1,
      up: async (db) => {},
      down: async (db) => {},
    };

    const isValid = validator.validateMigration(migration);

    expect(isValid).toBe(false);
    expect(validator.getErrors().length).toBeGreaterThan(0);
  });

  it('should reject migration without version', () => {
    const validator = createMigrationValidator();

    const migration = {
      name: 'test',
      up: async (db) => {},
      down: async (db) => {},
    };

    const isValid = validator.validateMigration(migration);

    expect(isValid).toBe(false);
  });

  it('should validate migration sequence', () => {
    const validator = createMigrationValidator();

    const migrations = [
      { name: 'migration_1', version: 1, up: async () => {}, down: async () => {} },
      { name: 'migration_2', version: 2, up: async () => {}, down: async () => {} },
      { name: 'migration_3', version: 3, up: async () => {}, down: async () => {} },
    ];

    const isValid = validator.validateMigrationSequence(migrations);

    expect(isValid).toBe(true);
  });

  it('should validate rollback parameters', () => {
    const validator = createMigrationValidator();

    const isValid = validator.validateRollback(3, 1);

    expect(isValid).toBe(true);
  });

  it('should reject invalid rollback', () => {
    const validator = createMigrationValidator();

    const isValid = validator.validateRollback(1, 3);

    expect(isValid).toBe(false);
  });
});
