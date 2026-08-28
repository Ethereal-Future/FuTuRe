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
    this.writeQueues = new Map();
  }

  registerProjection(name, handler) {
    this.projections.set(name, handler);
  }

  async project(name, events) {
    const handler = this.projections.get(name);
    if (!handler) {
      throw new Error(`Projection handler not found: ${name}`);
    }

    let projection = (await this.loadProjection(name)) || {};

    for (const event of events) {
      projection = handler(projection, event);
    }

    await this.saveProjection(name, projection);
    return projection;
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
