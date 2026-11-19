import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = path.join(__dirname, '../../data/compliance-audit');
const GENESIS_HASH = '0'.repeat(64);

// Immutable append-only compliance audit trail with cryptographic hash chaining.
class ComplianceAudit {
  async initialize() {
    await fs.mkdir(AUDIT_DIR, { recursive: true });
  }

  computeHash(prevHash, eventType, userId, details, timestamp) {
    return createHash('sha256')
      .update(prevHash + eventType + userId + JSON.stringify(details) + timestamp)
      .digest('hex');
  }

  async readAllEntries() {
    await this.initialize();

    try {
      const files = (await fs.readdir(AUDIT_DIR)).filter(f => f.endsWith('.jsonl')).sort();
      const entries = [];

      for (const file of files) {
        const content = await fs.readFile(path.join(AUDIT_DIR, file), 'utf-8');
        const lines = content.split('\n').filter(Boolean).map(l => JSON.parse(l));
        entries.push(...lines);
      }

      return entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } catch {
      return [];
    }
  }

  async getLatestHash() {
    const entries = await this.readAllEntries();
    return entries.length ? entries[entries.length - 1].currentHash : GENESIS_HASH;
  }

  async log(eventType, userId, details = {}) {
    await this.initialize();

    const prevHash = await this.getLatestHash();
    const timestamp = new Date().toISOString();
    const currentHash = this.computeHash(prevHash, eventType, userId, details, timestamp);

    const entry = {
      id: randomUUID(),
      timestamp,
      eventType,
      userId,
      details,
      prevHash,
      currentHash,
    };

    const file = path.join(AUDIT_DIR, `${timestamp.split('T')[0]}.jsonl`);
    await fs.appendFile(file, JSON.stringify(entry) + '\n');
    return entry;
  }

  async getTrail(filters = {}) {
    let result = await this.readAllEntries();
    result = result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (filters.userId) result = result.filter(e => e.userId === filters.userId);
    if (filters.eventType) result = result.filter(e => e.eventType === filters.eventType);
    if (filters.from) result = result.filter(e => new Date(e.timestamp) >= new Date(filters.from));
    if (filters.to) result = result.filter(e => new Date(e.timestamp) <= new Date(filters.to));

    return result;
  }

  // Traverse the chain from genesis to latest, detecting mutated or deleted rows.
  async verifyChain() {
    const entries = await this.readAllEntries();
    let expectedPrev = GENESIS_HASH;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      if (entry.prevHash !== expectedPrev) {
        return {
          valid: false,
          brokenAt: entry.id,
          index: i,
          reason: 'prevHash does not match previous entry currentHash (row mutated, deleted, or reordered)',
        };
      }

      const recomputed = this.computeHash(
        entry.prevHash,
        entry.eventType,
        entry.userId,
        entry.details,
        entry.timestamp
      );

      if (recomputed !== entry.currentHash) {
        return {
          valid: false,
          brokenAt: entry.id,
          index: i,
          reason: 'currentHash does not match recomputed hash (entry contents tampered)',
        };
      }

      expectedPrev = entry.currentHash;
    }

    return { valid: true, length: entries.length, head: expectedPrev };
  }

  // Merkle root over the ordered chain of currentHash values, for on-chain anchoring.
  async getMerkleRoot() {
    const entries = await this.readAllEntries();
    if (!entries.length) return GENESIS_HASH;

    let level = entries.map(e => e.currentHash);

    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left;
        next.push(createHash('sha256').update(left + right).digest('hex'));
      }
      level = next;
    }

    return level[0];
  }
}

export default new ComplianceAudit();
