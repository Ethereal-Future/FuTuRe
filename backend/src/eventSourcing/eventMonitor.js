import eventStore from './eventStore.js';
import eventReplayer from './eventReplayer.js';
import projectionManager from './projectionManager.js';
import eventAnalytics from './eventAnalytics.js';
import prisma from '../db/client.js';
import logger from '../config/logger.js';
import { registerMetricProvider } from '../monitoring/metrics.js';

const DEFAULT_PROJECTIONS = ['account-summary', 'payment-history'];

// projection_update_failed_total{projection, eventType} (#1360)
const failureCounts = new Map();

function escapeLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

registerMetricProvider((lines) => {
  lines.push('# HELP projection_update_failed_total Projection/listener updates that failed and were dead-lettered');
  lines.push('# TYPE projection_update_failed_total counter');
  for (const [key, count] of failureCounts) {
    const [projection, eventType] = key.split('\u0000');
    lines.push(
      `projection_update_failed_total{projection="${escapeLabel(projection)}",eventType="${escapeLabel(eventType)}"} ${count}`
    );
  }
});

function recordFailureMetric(projection, eventType) {
  const key = `${projection}\u0000${eventType}`;
  failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1);
}

class EventMonitor {
  constructor() {
    // name -> handler(event); projections and ad-hoc subscribers share this path
    this.handlers = new Map();
    this.initialized = false;

    for (const name of DEFAULT_PROJECTIONS) {
      this.handlers.set(name, (event) => projectionManager.project(name, [event]));
    }
  }

  get isInitialized() {
    return this.initialized;
  }

  async initialize() {
    await eventStore.initialize();
    this.initialized = true;
  }

  /**
   * Register a listener. The name identifies it in the dead-letter queue,
   * metrics and the projection status endpoint, so it must be stable across
   * restarts.
   */
  subscribe(handler, name = handler.name || `listener-${this.handlers.size}`) {
    if (this.handlers.has(name)) {
      throw new Error(`Event listener already registered: ${name}`);
    }
    this.handlers.set(name, handler);
  }

  /**
   * Append the event and fan it out to every listener/projection. The event
   * is durable once appended, so a listener failure does not fail the
   * publish; it is dead-lettered and surfaced via metrics and
   * GET /api/v1/events/projections/status instead.
   */
  async publishEvent(aggregateId, event) {
  async publishEvent(aggregateId, event, expectedVersion) {
    if (!this.initialized) await this.initialize();

    const storedEvent = await eventStore.append(aggregateId, event, expectedVersion);

    try {
      await eventAnalytics.recordMetric(`event_${event.type}`, 1, { aggregateId });
    } catch (error) {
      logger.warn('Failed to record event metric', { error: error.message, eventType: event.type });
    }

    for (const name of this.handlers.keys()) {
      await this.dispatch(name, storedEvent);
    }

    return storedEvent;
  }

  /**
   * Deliver one event to one listener. If the listener already has pending
   * dead letters the event is queued behind them rather than applied, so a
   * projection never folds events out of order.
   */
  async dispatch(name, event) {
    const handler = this.handlers.get(name);

    let pending = 0;
    try {
      pending = await prisma.projectionDeadLetter.count({ where: { projection: name, resolvedAt: null } });
    } catch (error) {
      logger.error('Failed to read projection dead-letter queue', { projection: name, error: error.message });
    }

    if (pending > 0) {
      await this.deadLetter(name, event, new Error(`Blocked behind ${pending} pending dead letter(s)`));
      return false;
    }

    try {
      await handler(event);
    } catch (error) {
      await this.deadLetter(name, event, error);
      return false;
    }

    await this.recordStatus(name, event, null);
    return true;
  }

  async deadLetter(name, event, error) {
    recordFailureMetric(name, event.type);
    logger.error('Projection update failed; event dead-lettered', { projection: name, queue: `projection:dlq:${name}`, eventId: event.id, eventType: event.type, error: error.message });

    try {
      await prisma.projectionDeadLetter.upsert({
        where: { projection_eventId: { projection: name, eventId: event.id } },
        update: { error: error.message, attempts: { increment: 1 }, lastAttemptAt: new Date() },
        create: {
          projection: name,
          eventId: event.id,
          aggregateId: event.aggregateId,
          eventType: event.type,
          event,
          error: error.message,
        },
      });
    } catch (dlqError) {
      // Last line of defence: the metric above has already fired.
      logger.error('Failed to write projection dead letter', { projection: name, eventId: event.id, error: dlqError.message });
    }

    await this.recordStatus(name, event, error);
  }

  async recordStatus(name, event, error) {
    const now = new Date();
    const fields = error
      ? { lastErrorAt: now, lastError: error.message, failureCount: { increment: 1 } }
      : { lastEventId: event.id, lastEventAt: new Date(event.timestamp), lastSuccessAt: now };

    try {
      await prisma.projectionStatus.upsert({
        where: { name },
        update: fields,
        create: {
          name,
          ...fields,
          failureCount: error ? 1 : 0,
        },
      });
    } catch (statusError) {
      logger.error('Failed to update projection status', { projection: name, error: statusError.message });
    }
  }

  /**
   * Re-deliver a listener's pending dead letters in their original order,
   * stopping at the first one that still fails.
   * @returns {Promise<{ processed: number, remaining: number, error?: string }>}
   */
  async retryDeadLetters(name) {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Unknown projection: ${name}`);

    const entries = await prisma.projectionDeadLetter.findMany({
      where: { projection: name, resolvedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    let processed = 0;
    for (const entry of entries) {
      try {
        await handler(entry.event);
      } catch (error) {
        await prisma.projectionDeadLetter.update({
          where: { id: entry.id },
          data: { error: error.message, attempts: { increment: 1 }, lastAttemptAt: new Date() },
        });
        recordFailureMetric(name, entry.eventType);
        await this.recordStatus(name, entry.event, error);
        return { processed, remaining: entries.length - processed, error: error.message };
      }

      await prisma.projectionDeadLetter.update({
        where: { id: entry.id },
        data: { resolvedAt: new Date() },
      });
      await this.recordStatus(name, entry.event, null);
      processed++;
    }

    return { processed, remaining: 0 };
  }

  /**
   * Sync health for every registered listener/projection.
   * @returns {Promise<{ healthy: boolean, projections: object[] }>}
   */
  async getProjectionStatus() {
    const names = [...this.handlers.keys()];
    const [statuses, pending, latest] = await Promise.all([
      prisma.projectionStatus.findMany({ where: { name: { in: names } } }),
      prisma.projectionDeadLetter.groupBy({
        by: ['projection'],
        where: { projection: { in: names }, resolvedAt: null },
        _count: { id: true },
        _min: { createdAt: true },
      }),
      prisma.eventStore.findFirst({
        where: { eventType: { not: '__metric__' } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const statusByName = new Map(statuses.map((s) => [s.name, s]));
    const pendingByName = new Map(pending.map((p) => [p.projection, p]));

    const projections = names.map((name) => {
      const status = statusByName.get(name);
      const dlq = pendingByName.get(name);
      const pendingDeadLetters = dlq?._count.id ?? 0;
      const lastEventAt = status?.lastEventAt ?? null;

      return {
        name,
        status: pendingDeadLetters > 0 ? 'failing' : 'healthy',
        pendingDeadLetters,
        oldestDeadLetterAt: dlq?._min.createdAt?.toISOString() ?? null,
        lastEventId: status?.lastEventId ?? null,
        lastEventAt: lastEventAt?.toISOString() ?? null,
        lagMs: latest && lastEventAt ? Math.max(0, latest.createdAt - lastEventAt) : null,
        lastSuccessAt: status?.lastSuccessAt?.toISOString() ?? null,
        lastErrorAt: status?.lastErrorAt?.toISOString() ?? null,
        lastError: status?.lastError ?? null,
        failureCount: status?.failureCount ?? 0,
      };
    });

    return { healthy: projections.every((p) => p.status === 'healthy'), projections };
  }

  async getEventHistory(aggregateId) {
    return eventStore.getEvents(aggregateId);
  }

  async getAggregateState(aggregateId) {
    return eventReplayer.replay(aggregateId);
  }

  async getProjection(name) {
    return projectionManager.getProjection(name);
  }

  async getAnalytics(eventType) {
    return eventAnalytics.getAnalytics(eventType);
  }

  async getEventStats() {
    return eventAnalytics.getEventStats();
  }
}

export default new EventMonitor();
