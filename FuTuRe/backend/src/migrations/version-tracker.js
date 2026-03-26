/**
 * Schema Version Tracker
 * Track and manage database schema versions
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const VERSION_FILE = '.schema-version.json';

export class SchemaVersionTracker {
  constructor() {
    this.versions = [];
    this.load();
  }

  load() {
    if (existsSync(VERSION_FILE)) {
      const data = JSON.parse(readFileSync(VERSION_FILE, 'utf-8'));
      this.versions = data.migrations || [];
    }
  }

  addVersion(name, version, description = '') {
    this.versions.push({
      name,
      version,
      description,
      timestamp: new Date().toISOString(),
      status: 'pending',
    });
    this.save();
  }

  markApplied(version) {
    const entry = this.versions.find((v) => v.version === version);
    if (entry) {
      entry.status = 'applied';
      entry.appliedAt = new Date().toISOString();
      this.save();
    }
  }

  markRolledBack(version) {
    const entry = this.versions.find((v) => v.version === version);
    if (entry) {
      entry.status = 'rolled_back';
      entry.rolledBackAt = new Date().toISOString();
      this.save();
    }
  }

  getVersion(version) {
    return this.versions.find((v) => v.version === version);
  }

  getCurrentVersion() {
    const applied = this.versions.filter((v) => v.status === 'applied');
    return applied.length > 0 ? Math.max(...applied.map((v) => v.version)) : 0;
  }

  getHistory() {
    return this.versions.sort((a, b) => a.version - b.version);
  }

  save() {
    writeFileSync(
      VERSION_FILE,
      JSON.stringify(
        {
          currentVersion: this.getCurrentVersion(),
          migrations: this.versions,
          lastUpdated: new Date().toISOString(),
        },
        null,
        2
      )
    );
  }
}

export const createSchemaVersionTracker = () => new SchemaVersionTracker();
