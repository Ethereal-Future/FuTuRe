import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../db/client.js';
import logger from '../config/logger.js';
import { incrementCounter } from '../monitoring/metrics.js';
import { KeyedLock } from './keyedLock.js';
import eventStore from './eventStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTIONS_DIR = path.join(__dirname, '../../data/projections');
/**
 * Projection Manager — stores and retrieves read-model projections in Postgres
 * via Prisma.  Replaces the old local-file approach that wrote per-projection
 * JSON files to backend/data/projections/ and was not visible to other process
 * instances.
 *
 * Migrated as part of Issue #1125.
 */
import prisma from '../db/client.js';

// Consecutive failures after which an event is treated as a poison pill.
export const MAX_PROJECTION_ATTEMPTS = 3;

class ProjectionManager {
  constructor() {
    this.projections = new Map();
    this.locks = new KeyedLock();
  }

  async initialize() {
    await fs.mkdir(PROJECTIONS_DIR, { recursive: true });
    this.writeQueues = new Map();
  }

  registerProjection(name, handler) {
    this.projections.set(name, handler);
  }

  hasProjection(name) {
    return this.projections.has(name);
  }

  getProjectionNames() {
    return [...this.projections.keys()];
  }

  /**
   * Fold `events` into the stored projection. Load→fold→save is serialized per
   * projection within this process so concurrent publishes cannot lose updates.
   */
  async project(name, events) {
  getHandler(name) {
    const handler = this.projections.get(name);
    if (!handler) {
      throw new Error(`Projection handler not found: ${name}`);
    }
    return handler;
  }

    const previous = this.writeQueues.get(name) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      let projection = (await this.loadProjection(name)) || {};

      for (const event of events) {
        projection = handler(projection, event);
      }

      await this.saveProjection(name, projection);
      return projection;
    });

    this.writeQueues.set(name, run);
    return run;
  /**
   * Folds events into a projection. Each projection records, per aggregate,
   * the last version (and event id) it applied, and events at or below that
   * version are skipped, so re-projecting or replaying events is a no-op
   * instead of applying them twice.
   */
  applyEvents(handler, projection, events) {
    const applied = projection._applied ?? {};
    let projection = (await this.loadProjection(name)) || {};

    for (const event of events) {
      const result = this.applyWithRetry(handler, projection, event);
      if (result.ok) {
        projection = result.projection;
        continue;
      }

      // Poison pill: quarantine it and keep processing the healthy events
      // behind it instead of freezing the whole projection.
      await this.quarantine(name, event, result.error, result.retryCount);
      const last = applied[event.aggregateId];
      // Streams written before versions were store-assigned can repeat a
      // version, so an equal version only counts as seen if it is the same event.
      if (last && (event.version < last.version ||
          (event.version === last.version && event.id === last.eventId))) {
        continue;
      }

      projection = handler(projection, event);
      applied[event.aggregateId] = { version: event.version, eventId: event.id };
    }

    projection._applied = applied;
    return projection;
  }

  /**
   * Apply `handler` to `event`, retrying up to MAX_PROJECTION_ATTEMPTS times.
   * Each attempt runs against a fresh copy of the projection so a handler that
   * throws midway through mutating state can't leave it half-applied.
   */
  applyWithRetry(handler, projection, event) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_PROJECTION_ATTEMPTS; attempt++) {
      try {
        return { ok: true, projection: handler(structuredClone(projection), event) };
      } catch (error) {
        lastError = error;
        event.retryCount = attempt;
      }
    }
    return { ok: false, error: lastError, retryCount: MAX_PROJECTION_ATTEMPTS };
  }

  async quarantine(name, event, error, retryCount) {
    logger.error('Poison-pill event quarantined', {
      severity: 'fatal',
      projection: name,
      event,
      error: { message: error?.message, stack: error?.stack },
    });
    incrementCounter('projection_poison_pill_quarantined_total');

    const record = {
      aggregateId: String(event?.aggregateId ?? 'unknown'),
      eventType: String(event?.type ?? 'unknown'),
      event: JSON.parse(JSON.stringify(event ?? null)),
      errorMessage: String(error?.message ?? error),
      errorStack: error?.stack ?? null,
      retryCount,
      status: 'QUARANTINED',
      resolvedAt: null,
    };

    try {
      await prisma.projectionPoisonPill.upsert({
        where: { projectionName_eventId: { projectionName: name, eventId: String(event?.id) } },
        create: { projectionName: name, eventId: String(event?.id), ...record },
        update: record,
      });
    } catch (dbError) {
      // Never let the quarantine store itself stall the pipeline; the fatal log
      // above carries the full event so it can still be recovered by hand.
      logger.error('Failed to persist poison-pill event', {
        projection: name,
        eventId: event?.id,
        error: dbError.message,
      });
    }
  }

  async listPoisonPills({ status = 'QUARANTINED', limit = 100 } = {}) {
    return prisma.projectionPoisonPill.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 1000),
    });
  }

  /**
   * Re-run a quarantined event through its projection. `repairedData`, when
   * given, replaces the event's `data` payload before replay.
   * @returns {Promise<{ resolved: boolean, pill: object, error?: string }>}
   */
  async retryPoisonPill(id, repairedData) {
    const pill = await prisma.projectionPoisonPill.findUnique({ where: { id } });
    if (!pill) {
      const err = new Error('Poison-pill event not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (pill.status === 'RESOLVED') {
      return { resolved: true, pill };
    }

    const handler = this.projections.get(pill.projectionName);
    if (!handler) {
      throw new Error(`Projection handler not found: ${pill.projectionName}`);
    }

    const event = { ...pill.event };
    delete event.retryCount;
    if (repairedData !== undefined) event.data = repairedData;

    const projection = await this.loadProjection(pill.projectionName) || {};
    try {
      const updated = handler(structuredClone(projection), event);
      await this.saveProjection(pill.projectionName, updated);
    } catch (error) {
      const failed = await prisma.projectionPoisonPill.update({
        where: { id },
        data: {
          event,
          errorMessage: error.message,
          errorStack: error.stack ?? null,
          retryCount: { increment: 1 },
        },
      });
      return { resolved: false, pill: failed, error: error.message };
    }

    const resolved = await prisma.projectionPoisonPill.update({
      where: { id },
      data: { event, status: 'RESOLVED', resolvedAt: new Date() },
    });
    logger.info('Poison-pill event replayed', { id, projection: pill.projectionName, eventId: pill.eventId });
    return { resolved: true, pill: resolved };
  }

  async saveProjection(name, data) {
    if (!this.writeQueues.has(name)) {
      this.writeQueues.set(name, Promise.resolve());
    }

    const queuePromise = this.writeQueues.get(name);
    const newPromise = queuePromise.then(async () => {
      const file = path.join(PROJECTIONS_DIR, `${name}.json`);
      const tmpFile = `${file}.tmp`;
  async project(name, events) {
    const handler = this.getHandler(name);

    // Serialize load-apply-save per projection so concurrent publishes for
    // different aggregates don't overwrite each other's updates.
    return this.locks.run(name, async () => {
      const projection = this.applyEvents(handler, await this.loadProjection(name) || {}, events);
      await this.saveProjection(name, projection);
      return projection;
    });
  }

  /**
   * Discards a projection's state and rebuilds it by folding every stored
   * event, in order, into an empty projection.
   */
  async rebuildFromGenesis(name) {
    const handler = this.getHandler(name);

    return this.locks.run(name, async () => {
      const events = await eventStore.readAllEvents();
      const projection = this.applyEvents(handler, {}, events);
      await this.saveProjection(name, projection);
      return projection;
    });
  }

  async saveProjection(name, data) {
    await prisma.eventProjection.upsert({
      where: { name },
      update: { data, updatedAt: new Date() },
      create: { name, data },
    });
  }

  async loadProjection(name) {
    const record = await prisma.eventProjection.findUnique({ where: { name } });
    return record?.data ?? null;
  }

  async getProjection(name) {
    return this.loadProjection(name);
  }
}

// ── Default projections ────────────────────────────────────────────────────────

const projectionManager = new ProjectionManager();

projectionManager.registerProjection('account-summary', (projection, event) => {
  if (!projection.accounts) projection.accounts = {};

  switch (event.type) {
    case 'AccountCreated':
      projection.accounts[event.aggregateId] = {
        publicKey: event.data.publicKey,
        createdAt: event.timestamp,
        status: 'created',
      };
      break;

    case 'AccountFunded':
      if (projection.accounts[event.aggregateId]) {
        projection.accounts[event.aggregateId].status = 'funded';
        projection.accounts[event.aggregateId].fundedAt = event.timestamp;
      }
      break;

    case 'BalanceChecked':
      if (projection.accounts[event.aggregateId]) {
        projection.accounts[event.aggregateId].lastBalance = event.data.balances;
        projection.accounts[event.aggregateId].lastBalanceCheck = event.timestamp;
      }
      break;
  }

  return projection;
});

projectionManager.registerProjection('payment-history', (projection, event) => {
  if (!projection.payments) projection.payments = [];

  if (event.type === 'PaymentSent') {
    projection.payments.push({
      aggregateId: event.aggregateId,
      destination: event.data.destination,
      amount: event.data.amount,
      asset: event.data.asset,
      hash: event.data.hash,
      feeBump: event.data.feeBump,
      memoType: event.data.memoType,
      timestamp: event.timestamp,
    });
  }

  return projection;
});

export default projectionManager;
