/**
 * Migration Validator
 * Validate migrations before execution
 */

export class MigrationValidator {
  constructor() {
    this.errors = [];
  }

  validateMigration(migration) {
    this.errors = [];

    if (!migration.name || typeof migration.name !== 'string') {
      this.errors.push('Migration must have a valid name');
    }

    if (!migration.version || typeof migration.version !== 'number') {
      this.errors.push('Migration must have a valid version number');
    }

    if (typeof migration.up !== 'function') {
      this.errors.push('Migration must have an up function');
    }

    if (typeof migration.down !== 'function') {
      this.errors.push('Migration must have a down function');
    }

    return this.errors.length === 0;
  }

  validateMigrationSequence(migrations) {
    this.errors = [];

    const versions = migrations.map((m) => m.version).sort((a, b) => a - b);
    for (let i = 1; i < versions.length; i++) {
      if (versions[i] <= versions[i - 1]) {
        this.errors.push(`Migration versions must be unique and increasing: ${versions[i - 1]} -> ${versions[i]}`);
      }
    }

    return this.errors.length === 0;
  }

  validateRollback(currentVersion, targetVersion) {
    this.errors = [];

    if (targetVersion >= currentVersion) {
      this.errors.push('Target version must be less than current version');
    }

    if (targetVersion < 0) {
      this.errors.push('Target version cannot be negative');
    }

    return this.errors.length === 0;
  }

  getErrors() {
    return this.errors;
  }
}

export const createMigrationValidator = () => new MigrationValidator();
