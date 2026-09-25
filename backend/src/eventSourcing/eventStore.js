import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import logger from '../config/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_DIR = path.join(__dirname, '../../data/events');
const SNAPSHOTS_DIR = path.join(__dirname, '../../data/snapshots');
/**
 * Event Store — durable, cross-instance implementation backed by Postgres via
 * Prisma.  Replaces the old local-file JSONL approach that stored events under
 * backend/data/events/ and was not visible to other process instances.
 *
 * Migrated as part of Issue #1125.
 */
import prisma from '../db/client.js';

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
      logger.error('Failed to initialize event store:', error);
      throw error;
    }
  }

  /**
   * Append a new event for an aggregate.
   * @param {string} aggregateId
   * @param {{ type: string, data: object, version?: number, metadata?: object }} event
   * @returns {Promise<object>} the persisted event record
   */
  async append(aggregateId, event) {
    if (!this.initialized) await this.initialize();

    const record = await prisma.eventStore.create({
      data: {
        aggregateId,
        eventType: event.type,
        payload: event.data ?? {},
        version: event.version ?? 1,
        metadata: event.metadata ?? {},
      },
    });

    return {
      id: record.id,
      aggregateId: record.aggregateId,
      type: record.eventType,
      data: record.payload,
      version: record.version,
      timestamp: record.createdAt.toISOString(),
      metadata: record.metadata,
    };
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
   * Retrieve all events for an aggregate, optionally after a given version.
   * @param {string} aggregateId
   * @param {number} [fromVersion=0]
   * @returns {Promise<object[]>}
   */
  async getEvents(aggregateId, fromVersion = 0) {
    const records = await prisma.eventStore.findMany({
      where: {
        aggregateId,
        version: { gt: fromVersion },
      },
      orderBy: { createdAt: 'asc' },
    });

    return records.map((r) => ({
      id: r.id,
      aggregateId: r.aggregateId,
      type: r.eventType,
      data: r.payload,
      version: r.version,
      timestamp: r.createdAt.toISOString(),
      metadata: r.metadata,
    }));
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

    return records.map((r) => ({
      id: r.id,
      aggregateId: r.aggregateId,
      type: r.eventType,
      data: r.payload,
      version: r.version,
      timestamp: r.createdAt.toISOString(),
      metadata: r.metadata,
    }));
  }

  /**
   * Persist an aggregate snapshot, upserting by aggregateId.
   * @param {string} aggregateId
   * @param {object} state
   * @param {number} version
   */
  async saveSnapshot(aggregateId, state, version) {
    await prisma.eventSnapshot.upsert({
      where: { aggregateId },
      update: { state, version, updatedAt: new Date() },
      create: { aggregateId, state, version },
    });
  }

  /**
   * Load the most recent snapshot for an aggregate.
   * @param {string} aggregateId
   * @returns {Promise<object|null>}
   */
  async getSnapshot(aggregateId) {
    const record = await prisma.eventSnapshot.findUnique({
      where: { aggregateId },
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
