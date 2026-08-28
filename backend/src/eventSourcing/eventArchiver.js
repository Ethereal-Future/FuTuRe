/**
 * Event Archiver — moves old events from the hot EventStore table to the
 * EventArchive table, which is backed by Postgres via Prisma.  Replaces the
 * old local-file approach that wrote archive files to backend/data/archive/
 * and was not visible to other process instances.
 *
 * Migrated as part of Issue #1125.
 */
import prisma from '../db/client.js';

class EventArchiver {
  /**
   * Move events older than `olderThanDays` from EventStore → EventArchive and
   * delete them from the hot table.
   *
   * @param {number} [olderThanDays=30]
   * @returns {Promise<{ events: number, aggregates: number }>}
   */
  async archiveOldEvents(olderThanDays = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    // Fetch all events that are old enough to archive
    const oldEvents = await prisma.eventStore.findMany({
      where: { createdAt: { lt: cutoffDate } },
      orderBy: { createdAt: 'asc' },
    });

    if (oldEvents.length === 0) {
      return { events: 0, aggregates: 0 };
    }

    // Bulk-insert into the archive table
    await prisma.eventArchive.createMany({
      data: oldEvents.map((e) => ({
        aggregateId: e.aggregateId,
        eventType: e.eventType,
        payload: e.payload,
        version: e.version,
        metadata: e.metadata,
        originalCreatedAt: e.createdAt,
      })),
      skipDuplicates: true,
    });

    // Delete archived events from the hot table
    await prisma.eventStore.deleteMany({
      where: { id: { in: oldEvents.map((e) => e.id) } },
    });

    const aggregateIds = new Set(oldEvents.map((e) => e.aggregateId));

    return { events: oldEvents.length, aggregates: aggregateIds.size };
  }

  /**
   * Retrieve all archived events for an aggregate, sorted by original creation
   * time (ascending).
   *
   * @param {string} aggregateId
   * @returns {Promise<object[]>}
   */
  async getArchivedEvents(aggregateId) {
    const records = await prisma.eventArchive.findMany({
      where: { aggregateId },
      orderBy: { originalCreatedAt: 'asc' },
    });

    return records.map((r) => ({
      id: r.id,
      aggregateId: r.aggregateId,
      type: r.eventType,
      data: r.payload,
      version: r.version,
      timestamp: r.originalCreatedAt.toISOString(),
      metadata: r.metadata,
    }));
  }

  /**
   * Return archived events for an aggregate that were originally created on or
   * before `toDate`.
   *
   * @param {string} aggregateId
   * @param {string|Date} toDate
   * @returns {Promise<object[]>}
   */
  async restoreFromArchive(aggregateId, toDate) {
    const cutoff = new Date(toDate);
    const records = await prisma.eventArchive.findMany({
      where: {
        aggregateId,
        originalCreatedAt: { lte: cutoff },
      },
      orderBy: { originalCreatedAt: 'asc' },
    });

    return records.map((r) => ({
      id: r.id,
      aggregateId: r.aggregateId,
      type: r.eventType,
      data: r.payload,
      version: r.version,
      timestamp: r.originalCreatedAt.toISOString(),
      metadata: r.metadata,
    }));
  }
}

export default new EventArchiver();
