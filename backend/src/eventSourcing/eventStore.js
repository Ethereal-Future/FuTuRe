import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { KeyedLock } from './keyedLock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_DIR = path.join(__dirname, '../../data/events');
const SNAPSHOTS_DIR = path.join(__dirname, '../../data/snapshots');
// Highest version ever appended per aggregate. Kept outside EVENTS_DIR so it
// survives archival, which removes old events from the stream files.
const HEADS_DIR = path.join(__dirname, '../../data/stream-heads');

export class ConcurrencyError extends Error {
  constructor(aggregateId, expectedVersion, actualVersion) {
    super(
      `Concurrency conflict on aggregate ${aggregateId}: ` +
      `expected version ${expectedVersion}, actual version ${actualVersion}`
    );
    this.name = 'ConcurrencyError';
    this.code = 'CONCURRENCY_CONFLICT';
    this.aggregateId = aggregateId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

class EventStore {
  constructor() {
    this.events = [];
    this.initialized = false;
    this.locks = new KeyedLock();
  }

  async initialize() {
    try {
      await fs.mkdir(EVENTS_DIR, { recursive: true });
      await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
      await fs.mkdir(HEADS_DIR, { recursive: true });
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize event store:', error);
      throw error;
    }
  }

  /**
   * Runs fn while holding the write lock for an aggregate's stream. Anything
   * that rewrites a stream file (e.g. archival) must go through this so it
   * cannot interleave with an append.
   */
  withAggregateLock(aggregateId, fn) {
    return this.locks.run(aggregateId, fn);
  }

  async getCurrentVersion(aggregateId) {
    if (!this.initialized) await this.initialize();

    try {
      const head = JSON.parse(await fs.readFile(path.join(HEADS_DIR, `${aggregateId}.json`), 'utf-8'));
      return head.version;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    // No head yet (stream predates head tracking): derive it from the stream
    // and persist it so it outlives the events it was derived from.
    const events = await this.getEvents(aggregateId);
    const version = events.reduce((max, e) => Math.max(max, e.version || 0), 0);
    if (version > 0) await this.writeHead(aggregateId, version);
    return version;
  }

  async writeHead(aggregateId, version) {
    await fs.writeFile(
      path.join(HEADS_DIR, `${aggregateId}.json`),
      JSON.stringify({ aggregateId, version })
    );
  }

  /**
   * Appends an event at the next version of the aggregate's stream.
   *
   * The store assigns the version; event.version is ignored. When
   * expectedVersion is given, the append is rejected with a ConcurrencyError
   * unless the stream is currently at exactly that version, so a writer that
   * decided on stale state has to reload and retry.
   */
  async append(aggregateId, event, expectedVersion) {
    if (!this.initialized) await this.initialize();

    return this.withAggregateLock(aggregateId, async () => {
      const currentVersion = await this.getCurrentVersion(aggregateId);
      if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== currentVersion) {
        throw new ConcurrencyError(aggregateId, expectedVersion, currentVersion);
      }

      const eventWithMetadata = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        aggregateId,
        type: event.type,
        data: event.data,
        version: currentVersion + 1,
        timestamp: new Date().toISOString(),
        metadata: event.metadata || {}
      };

      const eventFile = path.join(EVENTS_DIR, `${aggregateId}.jsonl`);
      await fs.appendFile(eventFile, JSON.stringify(eventWithMetadata) + '\n');
      await this.writeHead(aggregateId, eventWithMetadata.version);
      this.events.push(eventWithMetadata);

      return eventWithMetadata;
    });
  }

  async getEvents(aggregateId, fromVersion = 0) {
    if (!this.initialized) await this.initialize();

    const eventFile = path.join(EVENTS_DIR, `${aggregateId}.jsonl`);
    try {
      const content = await fs.readFile(eventFile, 'utf-8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line))
        .filter(event => event.version > fromVersion);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  /**
   * Every stored event across all aggregates, ordered by timestamp and, within
   * an aggregate, by version. Unlike getAllEvents, read errors propagate.
   */
  async readAllEvents() {
    if (!this.initialized) await this.initialize();

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

    return allEvents.sort((a, b) =>
      (new Date(a.timestamp) - new Date(b.timestamp)) ||
      (a.aggregateId === b.aggregateId ? a.version - b.version : 0)
    );
  }

  async getAllEvents(limit = 1000, offset = 0) {
    try {
      const allEvents = await this.readAllEvents();
      return allEvents.slice(offset, offset + limit);
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
