import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
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

  getHandler(name) {
    const handler = this.projections.get(name);
    if (!handler) {
      throw new Error(`Projection handler not found: ${name}`);
    }
    return handler;
  }

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
    if (!this.writeQueues.has(name)) {
      this.writeQueues.set(name, Promise.resolve());
    }

    const queuePromise = this.writeQueues.get(name);
    const newPromise = queuePromise.then(async () => {
      const file = path.join(PROJECTIONS_DIR, `${name}.json`);
      const tmpFile = `${file}.tmp`;

      await fs.writeFile(tmpFile, JSON.stringify(data, null, 2));
      await fs.rename(tmpFile, file);
    });

    this.writeQueues.set(name, newPromise);
    await newPromise;
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
      hash: event.data.hash,
      timestamp: event.timestamp,
    });
  }

  return projection;
});

export default projectionManager;
