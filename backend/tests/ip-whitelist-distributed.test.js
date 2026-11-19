/**
 * IP Whitelist distributed cache synchronization tests
 * Tests Redis pub/sub invalidation across multiple ECS tasks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isWhitelisted,
  addToWhitelist,
  removeFromWhitelist,
  clearWhitelist,
  reloadWhitelist,
  initializeCache,
} from '../src/security/ipWhitelist.js';

// Mock Redis client
const createMockRedis = () => {
  const store = new Map();
  const subscribers = new Map();
  const channels = new Map();

  return {
    store,
    subscribers,
    channels,
    status: 'ready',
    
    async connect() {
      this.status = 'ready';
    },
    
    async quit() {
      this.status = 'end';
    },
    
    async get(key) {
      return store.get(key) || null;
    },
    
    async set(key, value, ...args) {
      store.set(key, value);
      return 'OK';
    },
    
    async del(...keys) {
      keys.forEach(key => store.delete(key));
      return keys.length;
    },
    
    async subscribe(channel) {
      if (!channels.has(channel)) {
        channels.set(channel, []);
      }
      channels.get(channel).push(this);
    },
    
    async publish(channel, message) {
      const subs = channels.get(channel) || [];
      // Simulate async message delivery
      setImmediate(() => {
        subs.forEach(sub => {
          const handler = subscribers.get(sub);
          if (handler) {
            handler(channel, message);
          }
        });
      });
      return subs.length;
    },
    
    on(event, handler) {
      if (event === 'message') {
        subscribers.set(this, handler);
      } else if (event === 'error') {
        // Suppress error handlers in tests
      }
    },
  };
};

vi.mock('../src/db/client.js', () => ({
  default: {
    iPWhitelist: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../src/db/adminAuditLog.js', () => ({
  logAdminAction: vi.fn().mockResolvedValue({}),
}));

vi.mock('../src/config/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the Redis cache module
let mockPublisher = null;
let mockSubscriber = null;

vi.mock('../src/cache/redis.js', () => ({
  resolveRedisConfig: () => ({
    options: { host: 'localhost', port: 6379 },
    tlsEnabled: false,
  }),
}));

// Mock ioredis import
vi.mock('ioredis', () => {
  return {
    default: class Redis {
      constructor() {
        const redis = createMockRedis();
        if (!mockPublisher) {
          mockPublisher = redis;
        } else {
          mockSubscriber = redis;
        }
        return redis;
      }
    },
  };
});

import prisma from '../src/db/client.js';

describe('IP Whitelist Distributed Cache', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockPublisher = null;
    mockSubscriber = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Redis Pub/Sub Synchronization', () => {
    it('should initialize Redis pub/sub on cache init', async () => {
      vi.mocked(prisma.iPWhitelist.findMany).mockResolvedValueOnce([
        { ipAddress: '192.168.1.1', reason: 'Test' },
      ]);

      await initializeCache();

      expect(mockPublisher).toBeTruthy();
      expect(mockSubscriber).toBeTruthy();
      expect(mockPublisher.status).toBe('ready');
      expect(mockSubscriber.status).toBe('ready');
    });

    it('should publish cache update when adding IP', async () => {
      await initializeCache();

      const publishSpy = vi.spyOn(mockPublisher, 'publish');

      vi.mocked(prisma.iPWhitelist.create).mockResolvedValueOnce({
        ipAddress: '10.0.0.1',
        reason: 'Office',
        addedBy: 'admin1',
      });

      await addToWhitelist('10.0.0.1', 'Office', 'admin1');

      // Wait for async publish
      await new Promise(resolve => setImmediate(resolve));

      expect(publishSpy).toHaveBeenCalledWith(
        'ip_whitelist:updates',
        expect.stringContaining('"action":"add"')
      );
    });

    it('should publish cache update when removing IP', async () => {
      await initializeCache();

      // First add an IP
      vi.mocked(prisma.iPWhitelist.create).mockResolvedValueOnce({
        ipAddress: '10.0.0.1',
        reason: 'Test',
      });
      await addToWhitelist('10.0.0.1', 'Test', 'admin1');

      const publishSpy = vi.spyOn(mockPublisher, 'publish');
      vi.mocked(prisma.iPWhitelist.delete).mockResolvedValueOnce({});

      await removeFromWhitelist('10.0.0.1', 'admin1');

      // Wait for async publish
      await new Promise(resolve => setImmediate(resolve));

      expect(publishSpy).toHaveBeenCalledWith(
        'ip_whitelist:updates',
        expect.stringContaining('"action":"remove"')
      );
    });

    it('should publish clear message when clearing whitelist', async () => {
      await initializeCache();

      const publishSpy = vi.spyOn(mockPublisher, 'publish');
      vi.mocked(prisma.iPWhitelist.deleteMany).mockResolvedValueOnce({ count: 5 });

      await clearWhitelist('admin1');

      // Wait for async publish
      await new Promise(resolve => setImmediate(resolve));

      expect(publishSpy).toHaveBeenCalledWith(
        'ip_whitelist:updates',
        expect.stringContaining('"action":"clear"')
      );
    });

    it('should publish reload message when forcing reload', async () => {
      await initializeCache();

      const publishSpy = vi.spyOn(mockPublisher, 'publish');
      vi.mocked(prisma.iPWhitelist.findMany).mockResolvedValueOnce([]);

      await reloadWhitelist();

      // Wait for async publish
      await new Promise(resolve => setImmediate(resolve));

      expect(publishSpy).toHaveBeenCalledWith(
        'ip_whitelist:updates',
        expect.stringContaining('"action":"reload"')
      );
    });
  });

  describe('Multi-Instance Cache Coherence', () => {
    it('should update local cache when receiving add message from another instance', async () => {
      await initializeCache();

      // Simulate message from another instance
      const messageHandler = mockSubscriber.subscribers.get(mockSubscriber);
      expect(messageHandler).toBeTruthy();

      const addMessage = JSON.stringify({
        action: 'add',
        entry: {
          ipAddress: '172.16.0.1',
          reason: 'Added by instance 2',
        },
      });

      messageHandler('ip_whitelist:updates', addMessage);

      // Wait for message processing
      await new Promise(resolve => setImmediate(resolve));

      // Check if IP is now in local cache
      const whitelisted = await isWhitelisted('172.16.0.1');
      expect(whitelisted).toBe(true);
    });

    it('should remove from local cache when receiving remove message', async () => {
      await initializeCache();

      // First add an IP locally
      vi.mocked(prisma.iPWhitelist.create).mockResolvedValueOnce({
        ipAddress: '172.16.0.1',
        reason: 'Test',
      });
      await addToWhitelist('172.16.0.1', 'Test', 'admin1');

      // Verify it's whitelisted
      let whitelisted = await isWhitelisted('172.16.0.1');
      expect(whitelisted).toBe(true);

      // Simulate remove message from another instance
      const messageHandler = mockSubscriber.subscribers.get(mockSubscriber);
      const removeMessage = JSON.stringify({
        action: 'remove',
        ip: '172.16.0.1',
      });

      messageHandler('ip_whitelist:updates', removeMessage);

      // Wait for message processing
      await new Promise(resolve => setImmediate(resolve));

      // Check if IP is removed from local cache
      whitelisted = await isWhitelisted('172.16.0.1');
      expect(whitelisted).toBe(false);
    });

    it('should clear local cache when receiving clear message', async () => {
      await initializeCache();

      // Add multiple IPs
      vi.mocked(prisma.iPWhitelist.create).mockResolvedValue({
        ipAddress: '10.0.0.1',
      });
      await addToWhitelist('10.0.0.1', 'Test1', 'admin1');
      await addToWhitelist('10.0.0.2', 'Test2', 'admin1');

      // Simulate clear message from another instance
      const messageHandler = mockSubscriber.subscribers.get(mockSubscriber);
      const clearMessage = JSON.stringify({ action: 'clear' });

      messageHandler('ip_whitelist:updates', clearMessage);

      // Wait for message processing
      await new Promise(resolve => setImmediate(resolve));

      // Check if cache is cleared
      const whitelisted1 = await isWhitelisted('10.0.0.1');
      const whitelisted2 = await isWhitelisted('10.0.0.2');
      expect(whitelisted1).toBe(false);
      expect(whitelisted2).toBe(false);
    });

    it('should reload cache when receiving reload message', async () => {
      await initializeCache();

      // Add an IP
      vi.mocked(prisma.iPWhitelist.create).mockResolvedValueOnce({
        ipAddress: '10.0.0.1',
      });
      await addToWhitelist('10.0.0.1', 'Test', 'admin1');

      // Mock database to return different data on reload
      vi.mocked(prisma.iPWhitelist.findMany).mockResolvedValueOnce([
        { ipAddress: '192.168.1.1', reason: 'Reloaded' },
      ]);

      // Simulate reload message from another instance
      const messageHandler = mockSubscriber.subscribers.get(mockSubscriber);
      const reloadMessage = JSON.stringify({ action: 'reload' });

      messageHandler('ip_whitelist:updates', reloadMessage);

      // Wait for message processing and reload
      await new Promise(resolve => setTimeout(resolve, 100));

      // Old IP should be gone, new IP should be present
      const oldIP = await isWhitelisted('10.0.0.1');
      const newIP = await isWhitelisted('192.168.1.1');
      expect(oldIP).toBe(false);
      expect(newIP).toBe(true);
    });
  });

  describe('Redis Cache Miss Recovery', () => {
    it('should recover from cache miss by checking Redis', async () => {
      await initializeCache();

      // Simulate an IP that exists in Redis but not in local cache
      const ipData = JSON.stringify({
        ipAddress: '203.0.113.1',
        reason: 'Cached in Redis',
      });

      await mockPublisher.set('ip_whitelist:203.0.113.1', ipData);

      // Local cache doesn't have it initially
      let whitelisted = await isWhitelisted('203.0.113.1');
      
      // After first check, it should be recovered from Redis
      expect(whitelisted).toBe(true);
    });
  });

  describe('Redis Unavailability Handling', () => {
    it('should gracefully degrade when Redis is not configured', async () => {
      // Mock resolveRedisConfig to return null (Redis not configured)
      vi.resetModules();
      vi.doMock('../src/cache/redis.js', () => ({
        resolveRedisConfig: () => null,
      }));

      // Re-import to get the version without Redis
      const { initializeCache: initNoRedis, addToWhitelist: addNoRedis } = await import(
        '../src/security/ipWhitelist.js'
      );

      vi.mocked(prisma.iPWhitelist.findMany).mockResolvedValueOnce([]);
      await initNoRedis();

      // Should still work with local cache only
      vi.mocked(prisma.iPWhitelist.create).mockResolvedValueOnce({
        ipAddress: '10.0.0.1',
        reason: 'Test',
      });

      await expect(addNoRedis('10.0.0.1', 'Test', 'admin1')).resolves.toBeTruthy();
    });

    it('should continue operation when Redis publish fails', async () => {
      await initializeCache();

      // Make publish throw an error
      vi.spyOn(mockPublisher, 'publish').mockRejectedValueOnce(
        new Error('Redis connection lost')
      );

      vi.mocked(prisma.iPWhitelist.create).mockResolvedValueOnce({
        ipAddress: '10.0.0.1',
        reason: 'Test',
      });

      // Should not throw despite Redis failure
      await expect(addToWhitelist('10.0.0.1', 'Test', 'admin1')).resolves.toBeTruthy();
    });
  });

  describe('Cache Consistency Under Load', () => {
    it('should maintain consistency when multiple adds happen concurrently', async () => {
      await initializeCache();

      vi.mocked(prisma.iPWhitelist.create).mockImplementation(async ({ data }) => ({
        ipAddress: data.ipAddress,
        reason: data.reason,
      }));

      // Simulate concurrent adds from multiple instances
      const ips = ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5'];

      await Promise.all(
        ips.map(ip => addToWhitelist(ip, `Test ${ip}`, 'admin1'))
      );

      // Wait for all pub/sub messages to propagate
      await new Promise(resolve => setTimeout(resolve, 100));

      // All IPs should be whitelisted
      const results = await Promise.all(ips.map(ip => isWhitelisted(ip)));
      expect(results.every(r => r === true)).toBe(true);
    });
  });

  describe('Redis Connection Management', () => {
    it('should handle Redis errors gracefully', async () => {
      await initializeCache();

      // Simulate Redis error
      mockPublisher.status = 'end';

      vi.mocked(prisma.iPWhitelist.create).mockResolvedValueOnce({
        ipAddress: '10.0.0.1',
        reason: 'Test',
      });

      // Should not throw even though Redis is down
      await expect(addToWhitelist('10.0.0.1', 'Test', 'admin1')).resolves.toBeTruthy();
    });

    it('should handle malformed pub/sub messages gracefully', async () => {
      await initializeCache();

      const messageHandler = mockSubscriber.subscribers.get(mockSubscriber);

      // Send malformed JSON
      messageHandler('ip_whitelist:updates', 'not valid json{');

      // Wait for message processing
      await new Promise(resolve => setImmediate(resolve));

      // Should not crash - verify by attempting a normal operation
      vi.mocked(prisma.iPWhitelist.create).mockResolvedValueOnce({
        ipAddress: '10.0.0.1',
      });

      await expect(addToWhitelist('10.0.0.1', 'Test', 'admin1')).resolves.toBeTruthy();
    });
  });
});
