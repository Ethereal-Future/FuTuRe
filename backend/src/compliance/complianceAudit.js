import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = path.join(__dirname, '../../data/compliance-audit');

// Immutable append-only compliance audit trail.
class ComplianceAudit {
  async initialize() {
    await fs.mkdir(AUDIT_DIR, { recursive: true });
  }

  async log(eventType, userId, details = {}) {
    await this.initialize();

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      eventType,
      userId,
      details,
    };

    const file = path.join(AUDIT_DIR, `${new Date().toISOString().split('T')[0]}.jsonl`);
    await fs.appendFile(file, JSON.stringify(entry) + '\n');
    return entry;
  }

  async getTrail(filters = {}) {
    await this.initialize();

    try {
      const files = await fs.readdir(AUDIT_DIR);
      const entries = [];

      for (const file of files) {
        const content = await fs.readFile(path.join(AUDIT_DIR, file), 'utf-8');
        const lines = content.split('\n').filter(Boolean).map(l => JSON.parse(l));
        entries.push(...lines);
      }

      let result = entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      if (filters.userId) result = result.filter(e => e.userId === filters.userId);
      if (filters.eventType) result = result.filter(e => e.eventType === filters.eventType);
      if (filters.from) result = result.filter(e => new Date(e.timestamp) >= new Date(filters.from));
      if (filters.to) result = result.filter(e => new Date(e.timestamp) <= new Date(filters.to));

      return result;
    } catch {
      return [];
    }
  }
}

export default new ComplianceAudit();
