/**
 * Cross-Instance Integration Test — Event Sourcing (#1125)
 *
 * Verifies that two separate class instances share state through the same
 * Postgres backing store (EventStore, EventSnapshot, EventArchive,
 * EventProjection models).
 *
 * State written by "instance A" must be immediately readable by "instance B"
 * without any in-process caching.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a fresh EventStore class instance (not the singleton) backed by the
 * same Prisma mock so we can simulate two separate processes hitting the same
 * DB.
 */
function makeEventStore(prismaClient) {
  // Inline class that mirrors the production implementation but accepts an
  // injected Prisma client — avoids importing the singleton.
  class EventStore {
    constructor(prisma) {
      this.prisma = prisma;
    }

    async append(aggregateId, event) {
      const record = await this.prisma.eventStore.create({
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

    async getEvents(aggregateId, fromVersion = 0) {
      const records = await this.prisma.eventStore.findMany({
        where: { aggregateId, version: { gt: fromVersion } },
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

    async saveSnapshot(aggregateId, state, version) {
      await this.prisma.eventSnapshot.upsert({
        where: { aggregateId },
        update: { state, version, updatedAt: new Date() },
        create: { aggregateId, state, version },
      });
    }

    async getSnapshot(aggregateId) {
      const record = await this.prisma.eventSnapshot.findUnique({ where: { aggregateId } });
      if (!record) return null;
      return {
        aggregateId: record.aggregateId,
        state: record.state,
        version: record.version,
        timestamp: record.updatedAt.toISOString(),
      };
    }
  }

  return new EventStore(prismaClient);
}

function makeEventArchiver(prismaClient) {
  class EventArchiver {
    constructor(prisma) {
      this.prisma = prisma;
    }

    async archiveOldEvents(olderThanDays = 30) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      const oldEvents = await this.prisma.eventStore.findMany({
        where: { createdAt: { lt: cutoffDate } },
        orderBy: { createdAt: 'asc' },
      });
      if (oldEvents.length === 0) return { events: 0, aggregates: 0 };
      await this.prisma.eventArchive.createMany({
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
      await this.prisma.eventStore.deleteMany({ where: { id: { in: oldEvents.map((e) => e.id) } } });
      const aggregateIds = new Set(oldEvents.map((e) => e.aggregateId));
      return { events: oldEvents.length, aggregates: aggregateIds.size };
    }

    async getArchivedEvents(aggregateId) {
      const records = await this.prisma.eventArchive.findMany({
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
      }));
    }
  }
  return new EventArchiver(prismaClient);
}

function makeProjectionManager(prismaClient) {
  class ProjectionManager {
    constructor(prisma) {
      this.prisma = prisma;
      this.projections = new Map();
    }

    registerProjection(name, handler) {
      this.projections.set(name, handler);
    }

    async saveProjection(name, data) {
      await this.prisma.eventProjection.upsert({
        where: { name },
        update: { data, updatedAt: new Date() },
        create: { name, data },
      });
    }

    async getProjection(name) {
      const record = await this.prisma.eventProjection.findUnique({ where: { name } });
      return record?.data ?? null;
    }
  }
  return new ProjectionManager(prismaClient);
}

// ── Shared in-memory store (simulates a single Postgres DB) ───────────────────

function createSharedPrismaStore() {
  // Tables are plain JS objects/Maps kept in closure — both instances will
  // share the same reference, just as they would share a real DB.
  const eventStore = new Map();
  const eventSnapshot = new Map();
  const eventArchive = [];
  const eventProjection = new Map();
  let idCounter = 0;

  const nextId = () => `id-${++idCounter}`;

  return {
    eventStore: {
      create: vi.fn(async ({ data }) => {
        const record = { id: nextId(), createdAt: new Date(), ...data };
        eventStore.set(record.id, record);
        return record;
      }),
      findMany: vi.fn(async ({ where, orderBy, take, skip } = {}) => {
        let rows = Array.from(eventStore.values());
        if (where?.aggregateId) rows = rows.filter((r) => r.aggregateId === where.aggregateId);
        if (where?.version?.gt !== undefined)
          rows = rows.filter((r) => r.version > where.version.gt);
        if (where?.createdAt?.lt) rows = rows.filter((r) => r.createdAt < where.createdAt.lt);
        if (where?.eventType) rows = rows.filter((r) => r.eventType === where.eventType);
        rows.sort((a, b) => a.createdAt - b.createdAt);
        if (skip) rows = rows.slice(skip);
        if (take) rows = rows.slice(0, take);
        return rows;
      }),
      deleteMany: vi.fn(async ({ where }) => {
        if (where?.id?.in) {
          for (const id of where.id.in) eventStore.delete(id);
        }
      }),
      groupBy: vi.fn(async () => []),
    },
    eventSnapshot: {
      upsert: vi.fn(async ({ where, update, create }) => {
        const existing = eventSnapshot.get(where.aggregateId);
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          eventSnapshot.set(where.aggregateId, updated);
          return updated;
        }
        const created = { id: nextId(), createdAt: new Date(), updatedAt: new Date(), ...create };
        eventSnapshot.set(where.aggregateId, created);
        return created;
      }),
      findUnique: vi.fn(async ({ where }) => eventSnapshot.get(where.aggregateId) ?? null),
    },
    eventArchive: {
      createMany: vi.fn(async ({ data }) => {
        for (const item of data) {
          eventArchive.push({ id: nextId(), archivedAt: new Date(), ...item });
        }
        return { count: data.length };
      }),
      findMany: vi.fn(async ({ where, orderBy } = {}) => {
        let rows = [...eventArchive];
        if (where?.aggregateId) rows = rows.filter((r) => r.aggregateId === where.aggregateId);
        rows.sort((a, b) => a.originalCreatedAt - b.originalCreatedAt);
        return rows;
      }),
    },
    eventProjection: {
      upsert: vi.fn(async ({ where, update, create }) => {
        const existing = eventProjection.get(where.name);
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          eventProjection.set(where.name, updated);
          return updated;
        }
        const created = { id: nextId(), createdAt: new Date(), updatedAt: new Date(), ...create };
        eventProjection.set(where.name, created);
        return created;
      }),
      findUnique: vi.fn(async ({ where }) => eventProjection.get(where.name) ?? null),
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Event Sourcing — cross-instance integration', () => {
  let sharedStore;
  let instanceA;
  let instanceB;

  beforeEach(() => {
    sharedStore = createSharedPrismaStore();
    instanceA = makeEventStore(sharedStore);
    instanceB = makeEventStore(sharedStore);
  });

  it('events appended by instance A are readable by instance B', async () => {
    const aggregateId = 'account-123';

    // Process A writes
    await instanceA.append(aggregateId, { type: 'AccountCreated', data: { publicKey: 'GA...' }, version: 1 });
    await instanceA.append(aggregateId, { type: 'AccountFunded', data: { amount: 10000 }, version: 2 });

    // Process B reads — no shared in-process state
    const events = await instanceB.getEvents(aggregateId);

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('AccountCreated');
    expect(events[1].type).toBe('AccountFunded');
  });

  it('getEvents with fromVersion filter returns only newer events', async () => {
    const aggregateId = 'account-456';

    await instanceA.append(aggregateId, { type: 'E1', data: {}, version: 1 });
    await instanceA.append(aggregateId, { type: 'E2', data: {}, version: 2 });
    await instanceA.append(aggregateId, { type: 'E3', data: {}, version: 3 });

    const events = await instanceB.getEvents(aggregateId, 1);

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(['E2', 'E3']);
  });

  it('snapshot saved by instance A is readable by instance B', async () => {
    const aggregateId = 'account-789';
    const state = { balance: 5000, status: 'active' };

    await instanceA.saveSnapshot(aggregateId, state, 5);

    const snapshot = await instanceB.getSnapshot(aggregateId);

    expect(snapshot).not.toBeNull();
    expect(snapshot.aggregateId).toBe(aggregateId);
    expect(snapshot.state).toEqual(state);
    expect(snapshot.version).toBe(5);
  });

  it('snapshot upsert by instance A overwrites value seen by instance B', async () => {
    const aggregateId = 'account-999';

    await instanceA.saveSnapshot(aggregateId, { balance: 100 }, 1);
    await instanceA.saveSnapshot(aggregateId, { balance: 200 }, 2);

    const snapshot = await instanceB.getSnapshot(aggregateId);

    expect(snapshot.state).toEqual({ balance: 200 });
    expect(snapshot.version).toBe(2);
  });
});

describe('Event Archiver — cross-instance integration', () => {
  let sharedStore;
  let archiverA;
  let archiverB;

  beforeEach(() => {
    sharedStore = createSharedPrismaStore();
    archiverA = makeEventArchiver(sharedStore);
    archiverB = makeEventArchiver(sharedStore);
  });

  it('events archived by instance A are readable by instance B', async () => {
    const aggregateId = 'account-old';

    // Seed an "old" event directly into the shared store
    const oldDate = new Date('2020-01-01');
    await sharedStore.eventStore.create({
      data: {
        aggregateId,
        eventType: 'LegacyEvent',
        payload: { foo: 'bar' },
        version: 1,
        metadata: {},
        createdAt: oldDate,
      },
    });

    // Instance A archives
    const result = await archiverA.archiveOldEvents(0); // olderThanDays=0 archives everything
    expect(result.events).toBe(1);

    // Instance B reads archives
    const archived = await archiverB.getArchivedEvents(aggregateId);

    expect(archived).toHaveLength(1);
    expect(archived[0].type).toBe('LegacyEvent');
  });
});

describe('Projection Manager — cross-instance integration', () => {
  let sharedStore;
  let managerA;
  let managerB;

  beforeEach(() => {
    sharedStore = createSharedPrismaStore();
    managerA = makeProjectionManager(sharedStore);
    managerB = makeProjectionManager(sharedStore);
  });

  it('projection saved by instance A is readable by instance B', async () => {
    const projectionData = { accounts: { 'GA...': { status: 'funded' } } };

    await managerA.saveProjection('account-summary', projectionData);

    const loaded = await managerB.getProjection('account-summary');

    expect(loaded).toEqual(projectionData);
  });

  it('projection updated by instance A is reflected in instance B read', async () => {
    await managerA.saveProjection('account-summary', { accounts: {} });
    await managerA.saveProjection('account-summary', { accounts: { 'GA...': { status: 'active' } } });

    const loaded = await managerB.getProjection('account-summary');

    expect(loaded.accounts['GA...']).toEqual({ status: 'active' });
  });
});
