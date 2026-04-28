import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  eventStore,
  eventSerializer,
  eventReplayer,
  projectionManager,
  eventArchiver,
  eventAnalytics,
  eventMonitor
} from '../src/eventSourcing/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');

async function cleanup() {
  try {
    await fs.rm(DATA_DIR, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

describe('Event Sourcing System', () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('EventStore', () => {
    it('should append and retrieve events', async () => {
      await eventStore.initialize();

      const event = {
        type: 'AccountCreated',
        data: { publicKey: 'test-key' },
        version: 1
      };

      const stored = await eventStore.append('agg-store-test', event);
      expect(stored.type).toBe('AccountCreated');
      expect(stored.aggregateId).toBe('agg-store-test');

      const retrieved = await eventStore.getEvents('agg-store-test');
      expect(retrieved.length).toBeGreaterThan(0);
      expect(retrieved[0].type).toBe('AccountCreated');
    });

    it('should filter events by version', async () => {
      await eventStore.initialize();

      await eventStore.append('agg-filter-test', { type: 'Event1', version: 1 });
      await eventStore.append('agg-filter-test', { type: 'Event2', version: 2 });
      await eventStore.append('agg-filter-test', { type: 'Event3', version: 3 });

      const events = await eventStore.getEvents('agg-filter-test', 1);
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0].version).toBeGreaterThan(1);
    });

    it('should save and retrieve snapshots', async () => {
      await eventStore.initialize();

      const state = { publicKey: 'test', balance: 100 };
      await eventStore.saveSnapshot('agg-snapshot-test', state, 5);

      const snapshot = await eventStore.getSnapshot('agg-snapshot-test');
      expect(snapshot.state).toEqual(state);
      expect(snapshot.version).toBe(5);
    });
  });

  describe('EventSerializer', () => {
    it('should serialize events with schema version', () => {
      const event = {
        type: 'AccountCreated',
        data: { publicKey: 'test' }
      };

      const serialized = eventSerializer.serialize(event);
      expect(serialized.schemaVersion).toBe(1);
    });

    it('should deserialize events', () => {
      const serialized = {
        type: 'AccountCreated',
        data: { publicKey: 'test' },
        schemaVersion: 1
      };

      const deserialized = eventSerializer.deserialize(serialized);
      expect(deserialized.type).toBe('AccountCreated');
    });

    it('should convert to/from JSON', () => {
      const event = {
        type: 'PaymentSent',
        data: { amount: 100 }
      };

      const json = eventSerializer.toJSON(event);
      const restored = eventSerializer.fromJSON(json);

      expect(restored.type).toBe('PaymentSent');
      expect(restored.data.amount).toBe(100);
    });
  });

  describe('EventReplayer', () => {
    it('should replay events to current state', async () => {
      await eventStore.initialize();

      const event1 = await eventStore.append('agg-replay-1', {
        type: 'AccountCreated',
        data: { publicKey: 'test-key', secretKey: 'secret' },
        version: 1
      });

      const event2 = await eventStore.append('agg-replay-1', {
        type: 'BalanceChecked',
        data: { balances: [{ asset: 'XLM', balance: '100' }] },
        version: 2
      });

      const state = await eventReplayer.replay('agg-replay-1');
      expect(state.publicKey).toBe('test-key');
      expect(state.lastBalance).toBeDefined();
    });

    it('should replay to specific version', async () => {
      await eventStore.initialize();

      await eventStore.append('agg-version-test', {
        type: 'AccountCreated',
        data: { publicKey: 'test-key' },
        version: 1
      });

      await eventStore.append('agg-version-test', {
        type: 'PaymentSent',
        data: { destination: 'dest', amount: '50' },
        version: 2
      });

      const state = await eventReplayer.replay('agg-version-test', 1);
      expect(state.lastPayment).toBeUndefined();
    });
  });

  describe('ProjectionManager', () => {
    it('should project account summary', async () => {
      await projectionManager.initialize();

      const events = [
        {
          type: 'AccountCreated',
          aggregateId: 'agg-1',
          data: { publicKey: 'test-key' },
          timestamp: new Date().toISOString()
        }
      ];

      const projection = await projectionManager.project('account-summary', events);
      expect(projection.accounts['agg-1']).toBeDefined();
      expect(projection.accounts['agg-1'].status).toBe('created');
    });

    it('should project payment history', async () => {
      await projectionManager.initialize();

      // Load existing projection first
      let projection = await projectionManager.loadProjection('payment-history') || { payments: [] };

      const events = [
        {
          type: 'PaymentSent',
          aggregateId: 'agg-test-payment',
          data: { destination: 'dest', amount: '100', hash: 'hash123' },
          timestamp: new Date().toISOString()
        }
      ];

      projection = await projectionManager.project('payment-history', events);
      expect(projection.payments.length).toBeGreaterThan(0);
      expect(projection.payments.some(p => p.destination === 'dest')).toBe(true);
    });
  });

  describe('EventAnalytics', () => {
    it('should record and retrieve metrics', async () => {
      await eventAnalytics.initialize();

      await eventAnalytics.recordMetric('event_AccountCreated', 1, { aggregateId: 'agg-1' });
      await eventAnalytics.recordMetric('event_AccountCreated', 1, { aggregateId: 'agg-2' });

      const metrics = await eventAnalytics.getMetrics('event_AccountCreated');
      expect(metrics.length).toBeGreaterThanOrEqual(2);
    });

    it('should get event statistics', async () => {
      await eventAnalytics.initialize();

      await eventAnalytics.recordMetric('event_PaymentSent', 1);
      await eventAnalytics.recordMetric('event_PaymentSent', 1);
      await eventAnalytics.recordMetric('event_AccountCreated', 1);

      const stats = await eventAnalytics.getEventStats();
      expect(stats['event_PaymentSent']).toBeDefined();
      expect(stats['event_AccountCreated']).toBeDefined();
    });
  });

  describe('EventMonitor', () => {
    it('should publish events and update projections', async () => {
      await eventMonitor.initialize();

      const event = await eventMonitor.publishEvent('agg-1', {
        type: 'AccountCreated',
        data: { publicKey: 'test-key' },
        version: 1
      });

      expect(event.type).toBe('AccountCreated');
      expect(event.aggregateId).toBe('agg-1');

      const projection = await eventMonitor.getProjection('account-summary');
      expect(projection.accounts['agg-1']).toBeDefined();
    });

    it('should get aggregate state', async () => {
      await eventMonitor.initialize();

      await eventMonitor.publishEvent('agg-monitor-test', {
        type: 'AccountCreated',
        data: { publicKey: 'test-key' },
        version: 1
      });

      const state = await eventMonitor.getAggregateState('agg-monitor-test');
      expect(state.publicKey).toBe('test-key');
    });

    it('should get event statistics', async () => {
      await eventMonitor.initialize();

      await eventMonitor.publishEvent('agg-1', {
        type: 'AccountCreated',
        data: { publicKey: 'test-key' },
        version: 1
      });

      const stats = await eventMonitor.getEventStats();
      expect(stats['event_AccountCreated']).toBeDefined();
    });
  });
});
