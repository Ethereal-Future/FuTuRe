/**
 * Migration Framework
 * Core migration system for database schema versioning
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = './migrations';
const SCHEMA_VERSION_FILE = '.schema-version.json';

export class MigrationFramework {
  constructor(db = null) {
    this.db = db;
    this.migrations = [];
    this.currentVersion = 0;
    this.ensureMigrationsDir();
    this.loadSchemaVersion();
  }

  ensureMigrationsDir() {
    if (!existsSync(MIGRATIONS_DIR)) {
      mkdirSync(MIGRATIONS_DIR, { recursive: true });
    }
  }

  loadSchemaVersion() {
    if (existsSync(SCHEMA_VERSION_FILE)) {
      const data = JSON.parse(readFileSync(SCHEMA_VERSION_FILE, 'utf-8'));
      this.currentVersion = data.version || 0;
    }
  }

  saveSchemaVersion(version) {
    writeFileSync(
      SCHEMA_VERSION_FILE,
      JSON.stringify(
        {
          version,
          timestamp: new Date().toISOString(),
          migrations: this.migrations.map((m) => ({ name: m.name, version: m.version })),
        },
        null,
        2
      )
    );
    this.currentVersion = version;
  }

  registerMigration(name, version, up, down) {
    this.migrations.push({ name, version, up, down });
    this.migrations.sort((a, b) => a.version - b.version);
  }

  async migrate(targetVersion = null) {
    const target = targetVersion || Math.max(...this.migrations.map((m) => m.version));
    const toApply = this.migrations.filter((m) => m.version > this.currentVersion && m.version <= target);

    const results = [];
    for (const migration of toApply) {
      try {
        await migration.up(this.db);
        this.saveSchemaVersion(migration.version);
        results.push({ name: migration.name, version: migration.version, status: 'success' });
      } catch (error) {
        results.push({ name: migration.name, version: migration.version, status: 'failed', error: error.message });
        throw error;
      }
    }

    return results;
  }

  async rollback(steps = 1) {
    const toRollback = this.migrations
      .filter((m) => m.version <= this.currentVersion)
      .sort((a, b) => b.version - a.version)
      .slice(0, steps);

    const results = [];
    for (const migration of toRollback) {
      try {
        await migration.down(this.db);
        this.saveSchemaVersion(migration.version - 1);
        results.push({ name: migration.name, version: migration.version, status: 'rolled_back' });
      } catch (error) {
        results.push({ name: migration.name, version: migration.version, status: 'failed', error: error.message });
        throw error;
      }
    }

    return results;
  }

  getMigrationStatus() {
    return {
      currentVersion: this.currentVersion,
      latestVersion: Math.max(...this.migrations.map((m) => m.version), 0),
      migrations: this.migrations.map((m) => ({
        name: m.name,
        version: m.version,
        applied: m.version <= this.currentVersion,
      })),
    };
  }

  getPendingMigrations() {
    return this.migrations.filter((m) => m.version > this.currentVersion);
  }
}

export const createMigrationFramework = (db = null) => new MigrationFramework(db);
