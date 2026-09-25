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
  }

  async initialize() {
    this.initialized = true;
  }

  /**
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
