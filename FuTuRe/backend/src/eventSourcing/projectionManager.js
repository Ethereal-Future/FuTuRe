import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTIONS_DIR = path.join(__dirname, '../../data/projections');

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
      projection = handler(projection, event);
    }

    await this.saveProjection(name, projection);
    return projection;
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
