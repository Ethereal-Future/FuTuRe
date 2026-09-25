import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_DIR = path.join(__dirname, '../../data/events');
const SNAPSHOTS_DIR = path.join(__dirname, '../../data/snapshots');

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 1000;

export function clampLimit(limit) {
  const n = parseInt(limit, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}

class EventStore {
  constructor() {
    this.events = [];
    this.initialized = false;
  }

  async initialize() {
    try {
      await fs.mkdir(EVENTS_DIR, { recursive: true });
      await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize event store:', error);
      throw error;
    }
  }

  async append(aggregateId, event) {
    if (!this.initialized) await this.initialize();

    const eventWithMetadata = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      aggregateId,
      type: event.type,
      data: event.data,
      version: event.version || 1,
      timestamp: new Date().toISOString(),
      metadata: event.metadata || {}
    };

    const eventFile = path.join(EVENTS_DIR, `${aggregateId}.jsonl`);
    await fs.appendFile(eventFile, JSON.stringify(eventWithMetadata) + '\n');
    this.events.push(eventWithMetadata);

    return eventWithMetadata;
  }

  /**
   * Fetch one bounded page of an aggregate's events, oldest first.
   * @param {string} aggregateId
   * @param {object} [options]
   * @param {number} [options.fromVersion=0] - Only events with version > fromVersion
   * @param {number} [options.limit=100] - Page size, clamped to [1, MAX_PAGE_SIZE]
   * @param {string|null} [options.cursor] - `nextCursor` from the previous page
   * @returns {Promise<{ events: object[], nextCursor: string|null }>}
   */
  async getEvents(aggregateId, options = {}) {
    const { fromVersion = 0, cursor = null } = options;
    const limit = clampLimit(options.limit);

    const events = [];
    let hasMore = false;
    for await (const event of this.streamEvents(aggregateId, { fromVersion, cursor })) {
      if (events.length === limit) {
        hasMore = true;
        break;
      }
      events.push(event);
    }

    return {
      events,
      nextCursor: hasMore ? events[events.length - 1].id : null,
    };
  }

  /**
   * Iterate over an aggregate's events one at a time without loading the
   * whole log into memory. Intended for replays and background jobs.
   * @param {string} aggregateId
   * @param {object} [options]
   * @param {number} [options.fromVersion=0]
   * @param {string|null} [options.cursor] - Resume after the event with this id
   */
  async *streamEvents(aggregateId, { fromVersion = 0, cursor = null } = {}) {
    if (!this.initialized) await this.initialize();

    const eventFile = path.join(EVENTS_DIR, `${aggregateId}.jsonl`);
    let handle;
    try {
      handle = await fs.open(eventFile, 'r');
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }

    // Event ids are `${epochMs}-${random}` and the log is append-only, so if
    // the cursor event was archived away we resume at the first later event.
    const cursorMs = cursor ? parseInt(cursor, 10) : null;
    let pastCursor = !cursor;

    const lines = readline.createInterface({ input: handle.createReadStream(), crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);

        if (!pastCursor) {
          if (event.id === cursor) {
            pastCursor = true;
            continue;
          }
          if (!(parseInt(event.id, 10) > cursorMs)) continue;
          pastCursor = true;
        }

        if (event.version > fromVersion) yield event;
      }
    } finally {
      lines.close();
      await handle.close();
    }
  }

  async getAllEvents(limit = 1000, offset = 0) {
    if (!this.initialized) await this.initialize();

    try {
      const files = await fs.readdir(EVENTS_DIR);
      const allEvents = [];

      for (const file of files) {
        const content = await fs.readFile(path.join(EVENTS_DIR, file), 'utf-8');
        const events = content
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
        allEvents.push(...events);
      }

      return allEvents
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .slice(offset, offset + limit);
    } catch (error) {
      console.error('Failed to get all events:', error);
      return [];
    }
  }

  async saveSnapshot(aggregateId, state, version) {
    if (!this.initialized) await this.initialize();

    const snapshot = {
      aggregateId,
      state,
      version,
      timestamp: new Date().toISOString()
    };

    const snapshotFile = path.join(SNAPSHOTS_DIR, `${aggregateId}.json`);
    await fs.writeFile(snapshotFile, JSON.stringify(snapshot, null, 2));
  }

  async getSnapshot(aggregateId) {
    if (!this.initialized) await this.initialize();

    const snapshotFile = path.join(SNAPSHOTS_DIR, `${aggregateId}.json`);
    try {
      const content = await fs.readFile(snapshotFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
}

export default new EventStore();
