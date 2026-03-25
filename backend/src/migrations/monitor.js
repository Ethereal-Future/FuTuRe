/**
 * Migration Monitor
 * Track and monitor migration execution
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const LOGS_DIR = './migration-logs';

export class MigrationMonitor {
  constructor() {
    this.logs = [];
    this.ensureLogsDir();
  }

  ensureLogsDir() {
    if (!existsSync(LOGS_DIR)) {
      mkdirSync(LOGS_DIR, { recursive: true });
    }
  }

  logMigration(name, version, status, duration, details = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      name,
      version,
      status,
      duration,
      details,
    };

    this.logs.push(entry);
    this.saveLog(entry);

    return entry;
  }

  saveLog(entry) {
    const filename = `migration-${entry.version}-${Date.now()}.json`;
    const filepath = join(LOGS_DIR, filename);
    writeFileSync(filepath, JSON.stringify(entry, null, 2));
  }

  getExecutionHistory(limit = 10) {
    return this.logs.slice(-limit).reverse();
  }

  getStatistics() {
    const successful = this.logs.filter((l) => l.status === 'success').length;
    const failed = this.logs.filter((l) => l.status === 'failed').length;
    const totalDuration = this.logs.reduce((sum, l) => sum + (l.duration || 0), 0);

    return {
      total: this.logs.length,
      successful,
      failed,
      successRate: ((successful / this.logs.length) * 100).toFixed(2) + '%',
      totalDuration,
      avgDuration: (totalDuration / this.logs.length).toFixed(2),
    };
  }

  getMigrationLog(version) {
    return this.logs.filter((l) => l.version === version);
  }
}

export const createMigrationMonitor = () => new MigrationMonitor();
