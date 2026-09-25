import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../db/client.js';
import logger from '../config/logger.js';
import { incrementCounter } from '../monitoring/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTIONS_DIR = path.join(__dirname, '../../data/projections');

// Consecutive failures after which an event is treated as a poison pill.
export const MAX_PROJECTION_ATTEMPTS = 3;

class ProjectionManager {
  constructor() {
    this.projections = new Map();
  }

  async initialize() {
    await fs.mkdir(PROJECTIONS_DIR, { recursive: true });
  }

  registerProjection(name, handler) {
    this.projections.set(name, handler);
  }

  async project(name, events) {
    const handler = this.projections.get(name);
    if (!handler) {
      throw new Error(`Projection handler not found: ${name}`);
    }

    let projection = await this.loadProjection(name) || {};

    for (const event of events) {
      const result = this.applyWithRetry(handler, projection, event);
      if (result.ok) {
        projection = result.projection;
        continue;
      }

      // Poison pill: quarantine it and keep processing the healthy events
      // behind it instead of freezing the whole projection.
      await this.quarantine(name, event, result.error, result.retryCount);
    }

    await this.saveProjection(name, projection);
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
    const file = path.join(PROJECTIONS_DIR, `${name}.json`);
    await fs.writeFile(file, JSON.stringify(data, null, 2));
  }

  async loadProjection(name) {
    const file = path.join(PROJECTIONS_DIR, `${name}.json`);
    try {
      const content = await fs.readFile(file, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async getProjection(name) {
    return this.loadProjection(name);
  }
}

// Default projections
const projectionManager = new ProjectionManager();

projectionManager.registerProjection('account-summary', (projection, event) => {
  if (!projection.accounts) projection.accounts = {};

  switch (event.type) {
    case 'AccountCreated':
      projection.accounts[event.aggregateId] = {
        publicKey: event.data.publicKey,
        createdAt: event.timestamp,
        status: 'created'
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
      hash: event.data.hash,
      timestamp: event.timestamp
    });
  }

  return projection;
});

export default projectionManager;
