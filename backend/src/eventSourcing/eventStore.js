import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

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

class EventStore {
  /**
   * Append a new event for an aggregate.
   * @param {string} aggregateId
   * @param {{ type: string, data: object, version?: number, metadata?: object }} event
   * @returns {Promise<object>} the persisted event record
   */
  async append(aggregateId, event) {
    if (!this.initialized) await this.initialize();

    const eventWithMetadata = {
      id: randomUUID(),
      aggregateId,
      type: event.type,
      data: event.data,
      version: event.version || 1,
      timestamp: new Date().toISOString(),
      metadata: event.metadata || {}
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
