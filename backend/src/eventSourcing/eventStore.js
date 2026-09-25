import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { KeyedLock } from './keyedLock.js';
import logger from '../config/logger.js';

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
/**
 * Event Store — durable, cross-instance implementation backed by Postgres via
 * Prisma.  Replaces the old local-file JSONL approach that stored events under
 * backend/data/events/ and was not visible to other process instances.
 *
 * Migrated as part of Issue #1125.
 *
 * Every event is stamped with the schema version it was written in
 * (`metadata.schemaVersion`) and is upcast to the latest schema on read (#1359),
 * so stored rows are never rewritten.
 */
import prisma from '../db/client.js';
import logger from '../config/logger.js';
import eventSerializer from './eventSerializer.js';

/** Take an aggregate snapshot every N events (#1362). */
export const SNAPSHOT_INTERVAL = parseInt(process.env.EVENT_SNAPSHOT_INTERVAL, 10) || 500;

function toEvent(record) {
  const { schemaVersion, ...metadata } = record.metadata ?? {};
  return eventSerializer.deserializeEvent({
    id: record.id,
    aggregateId: record.aggregateId,
    type: record.eventType,
    data: record.payload,
    version: record.version,
    // Rows written before schema versions were persisted are v1.
    schemaVersion: schemaVersion ?? 1,
    timestamp: record.createdAt.toISOString(),
    metadata,
  });
}

class EventStore {
  constructor() {
    this.events = [];
    this.initialized = false;
    this.locks = new KeyedLock();
  }

  async initialize() {
    this.initialized = true;
    try {
      await fs.mkdir(EVENTS_DIR, { recursive: true });
      await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
      await fs.mkdir(HEADS_DIR, { recursive: true });
      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize event store:', error);
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
   * Append a new event for an aggregate.
   *
   * The aggregate version is assigned here as (latest version + 1) under a
   * per-aggregate advisory lock, so versions form a gap-free sequence that
   * replay and snapshotting can rely on. Any `event.version` supplied by the
   * caller is ignored.
   *
   * @param {string} aggregateId
   * @param {{ type: string, data: object, metadata?: object }} event
   * @returns {Promise<object>} the persisted event, in its latest schema shape
   */
  async append(aggregateId, event) {
    if (!this.initialized) await this.initialize();

    const schemaVersion = eventSerializer.currentVersion(event.type);
    const metadata = { ...(event.metadata ?? {}) };
    if (schemaVersion !== undefined) metadata.schemaVersion = schemaVersion;

    // Reject payloads that would fail validation on read before they become
    // an immutable part of the log.
    eventSerializer.deserializeEvent({ type: event.type, data: event.data ?? {}, schemaVersion });

    const record = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${aggregateId}))::text`;
      const latest = await tx.eventStore.aggregate({
        where: { aggregateId },
        _max: { version: true },
      });

      return tx.eventStore.create({
        data: {
          aggregateId,
          eventType: event.type,
          payload: event.data ?? {},
          version: (latest._max.version ?? 0) + 1,
          metadata,
        },
      });
    });

    if (record.version % SNAPSHOT_INTERVAL === 0) {
      await this.takeSnapshot(aggregateId, record.version);
    }

    return toEvent(record);
  }

  /**
   * Snapshot failures must not fail the append (the event is already
   * committed); the next interval will try again.
   */
  async takeSnapshot(aggregateId, version) {
    try {
      // Imported lazily: eventReplayer depends on this module.
      const { default: eventReplayer } = await import('./eventReplayer.js');
      await eventReplayer.createSnapshot(aggregateId, version);
    } catch (error) {
      logger.warn('Failed to create aggregate snapshot', { aggregateId, version, error: error.message });
    }
  }

  /**
   * Retrieve all events for an aggregate, optionally after a given version.
   * @param {string} aggregateId
   * @param {number} [fromVersion=0]  exclusive lower bound
   * @param {number|null} [toVersion=null]  inclusive upper bound
   * @returns {Promise<object[]>}
   */
  async getEvents(aggregateId, fromVersion = 0, toVersion = null) {
    const version = { gt: fromVersion };
    if (toVersion != null) version.lte = toVersion;

    const records = await prisma.eventStore.findMany({
      where: { aggregateId, version },
      orderBy: [{ version: 'asc' }, { createdAt: 'asc' }],
    });

    return records.map(toEvent);
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
   * Retrieve a paginated, time-ordered view of all events across all aggregates.
   * @param {number} [limit=1000]
   * @param {number} [offset=0]
   * @returns {Promise<object[]>}
   */
  async getAllEvents(limit = 1000, offset = 0) {
    if (!this.initialized) await this.initialize();

    const records = await prisma.eventStore.findMany({
      orderBy: { createdAt: 'asc' },
      take: limit,
      skip: offset,
    });

    return records.map(toEvent);
  }

  /**
   * Persist an aggregate snapshot at a given version. Snapshots are kept per
   * version; re-saving the same version overwrites it.
   * @param {string} aggregateId
   * @param {object} state
   * @param {number} version
   * @param {number} [reducerVersion=1]  version of the fold logic that produced `state`
   */
  async saveSnapshot(aggregateId, state, version, reducerVersion = 1) {
    await prisma.eventSnapshot.upsert({
      where: { aggregateId_version: { aggregateId, version } },
      update: { state, reducerVersion },
      create: { aggregateId, state, version, reducerVersion },
    });
  }

  /**
   * Load the most recent snapshot for an aggregate.
   * @param {string} aggregateId
   * @param {{ maxVersion?: number|null, reducerVersion?: number }} [options]
   *   `maxVersion` limits the search to snapshots at or below that version;
   *   `reducerVersion` ignores snapshots produced by different fold logic.
   * @returns {Promise<object|null>}
   */
  async getSnapshot(aggregateId, { maxVersion = null, reducerVersion } = {}) {
    const where = { aggregateId };
    if (maxVersion != null) where.version = { lte: maxVersion };
    if (reducerVersion !== undefined) where.reducerVersion = reducerVersion;

    const record = await prisma.eventSnapshot.findFirst({
      where,
      orderBy: { version: 'desc' },
    });
    if (!record) return null;

    return {
      aggregateId: record.aggregateId,
      state: record.state,
      version: record.version,
      timestamp: record.updatedAt.toISOString(),
    };
  }
}

export default new EventStore();
