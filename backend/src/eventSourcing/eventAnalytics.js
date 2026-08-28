/**
 * Event Analytics — records per-event-type metrics and aggregates them from
 * Postgres via Prisma.  Replaces the old local-file approach that appended to
 * JSONL metric files under backend/data/metrics/ and was not visible to other
 * process instances.
 *
 * Metrics are stored as EventStore rows so that the existing schema covers the
 * analytics use-case without an additional table.  Each recorded metric is an
 * event of type "__metric__" whose payload carries { name, value, tags }.
 *
 * Migrated as part of Issue #1125.
 */
import prisma from '../db/client.js';

class EventAnalytics {
  /**
   * Record a named metric value with optional tags.
   * @param {string} name  — metric name, e.g. "payment.processed"
   * @param {number} value
   * @param {object} [tags={}]
   */
  async recordMetric(name, value, tags = {}) {
    await prisma.eventStore.create({
      data: {
        aggregateId: `metric:${name}`,
        eventType: '__metric__',
        payload: { name, value, tags },
        version: 1,
        metadata: {},
      },
    });
  }

  /**
   * Retrieve the most recent `limit` metric entries for a named metric.
   * @param {string} name
   * @param {number} [limit=1000]
   * @returns {Promise<object[]>}
   */
  async getMetrics(name, limit = 1000) {
    const records = await prisma.eventStore.findMany({
      where: {
        aggregateId: `metric:${name}`,
        eventType: '__metric__',
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    return records.map((r) => ({
      name: r.payload.name,
      value: r.payload.value,
      tags: r.payload.tags,
      timestamp: r.createdAt.toISOString(),
    }));
  }

  /**
   * Return aggregate analytics for all events whose aggregateId starts with
   * the given `eventType` prefix.
   * @param {string} eventType
   * @returns {Promise<object|null>}
   */
  async getAnalytics(eventType) {
    const records = await prisma.eventStore.findMany({
      where: { eventType },
      orderBy: { createdAt: 'asc' },
    });

    const analytics = {
      eventType,
      totalEvents: records.length,
      eventsByHour: {},
      eventsByType: {},
    };

    for (const record of records) {
      const hour = record.createdAt.toISOString().slice(0, 13);
      analytics.eventsByHour[hour] = (analytics.eventsByHour[hour] || 0) + 1;
    }

    return analytics;
  }

  /**
   * Return a summary of all distinct event types with their count and last
   * occurrence timestamp.
   * @returns {Promise<object>}
   */
  async getEventStats() {
    const rows = await prisma.eventStore.groupBy({
      by: ['eventType'],
      _count: { id: true },
      _max: { createdAt: true },
      where: { eventType: { not: '__metric__' } },
    });

    const stats = {};
    for (const row of rows) {
      stats[row.eventType] = {
        count: row._count.id,
        lastOccurrence: row._max.createdAt?.toISOString() ?? null,
      };
    }

    return stats;
  }
}

export default new EventAnalytics();
