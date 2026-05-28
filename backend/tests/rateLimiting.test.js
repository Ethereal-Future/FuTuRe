import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createRateLimiter, getClientIP } from '../src/middleware/rateLimiter.js';
import { isWhitelisted, addToWhitelist, removeFromWhitelist } from '../src/security/ipWhitelist.js';

describe('IP Whitelist', () => {
  const TEST_IP = '10.0.0.1';
  const TEST_IP2 = '10.0.0.2';

  beforeEach(() => {
    removeFromWhitelist(TEST_IP);
    removeFromWhitelist(TEST_IP2);
  });

  it('should return false for non-whitelisted IP', () => {
    expect(isWhitelisted('192.168.1.1')).toBe(false);
  });

  it('should return true for whitelisted IP', () => {
    addToWhitelist(TEST_IP);
    expect(isWhitelisted(TEST_IP)).toBe(true);
  });

  it('should allow adding multiple IPs', () => {
    addToWhitelist(TEST_IP);
    addToWhitelist(TEST_IP2);
    expect(isWhitelisted(TEST_IP)).toBe(true);
    expect(isWhitelisted(TEST_IP2)).toBe(true);
  });

  it('should allow removing IPs from whitelist', () => {
    addToWhitelist(TEST_IP);
    removeFromWhitelist(TEST_IP);
    expect(isWhitelisted(TEST_IP)).toBe(false);
  });
});

describe('getClientIP', () => {
  it('should extract IP from x-forwarded-for header', () => {
    const req = {
      headers: { 'x-forwarded-for': '192.168.1.100, 10.0.0.1' },
      ip: '127.0.0.1',
    };
    expect(getClientIP(req)).toBe('192.168.1.100');
  });

  it('should fall back to req.ip', () => {
    const req = {
      headers: {},
      ip: '127.0.0.1',
    };
    expect(getClientIP(req)).toBe('127.0.0.1');
  });

  it('should fall back to connection.remoteAddress', () => {
    const req = {
      headers: {},
      connection: { remoteAddress: '192.168.1.1' },
    };
    expect(getClientIP(req)).toBe('192.168.1.1');
  });
});

describe('Rate Limiter Middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('basic rate limiting', () => {
    it('should allow requests under the limit', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, max: 10 });
      app.use(limiter);
      app.get('/test', (req, res) => res.json({ ok: true }));

      for (let i = 0; i < 5; i++) {
        const res = await request(app).get('/test');
        expect(res.status).toBe(200);
      }
    });

    it('should block requests over the limit with 429', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, max: 2 });
      app.use(limiter);
      app.get('/test', (req, res) => res.json({ ok: true }));

      await request(app).get('/test');
      await request(app).get('/test');

      const exceededRes = await request(app).get('/test');
      expect(exceededRes.status).toBe(429);
    });

    it('should return proper error response when rate limited', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
      app.use(limiter);
      app.get('/test', (req, res) => res.json({ ok: true }));

      await request(app).get('/test');
      const res = await request(app).get('/test');

      expect(res.status).toBe(429);
      expect(res.body.error).toBeDefined();
      expect(res.body.statusCode).toBe(429);
      expect(res.body.retryAfter).toBeDefined();
    });

    it('should include rate limit headers', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, max: 10, standardHeaders: true });
      app.use(limiter);
      app.get('/test', (req, res) => res.json({ ok: true }));

      const res = await request(app).get('/test');
      expect(res.headers['ratelimit-limit']).toBeDefined();
      expect(res.headers['ratelimit-remaining']).toBeDefined();
      expect(res.headers['ratelimit-reset']).toBeDefined();
    });

    it('should include retry-after header when exceeded', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
      app.use(limiter);
      app.get('/test', (req, res) => res.json({ ok: true }));

      await request(app).get('/test');
      const res = await request(app).get('/test');

      expect(res.headers['retry-after']).toBeDefined();
    });
  });

  describe('custom configurations', () => {
    it('should apply different limits to different routes', async () => {
      const strictLimiter = createRateLimiter({ windowMs: 60000, max: 1 });
      const looseLimiter = createRateLimiter({ windowMs: 60000, max: 5 });

      app.use('/strict', strictLimiter);
      app.use('/loose', looseLimiter);

      app.get('/strict/test', (req, res) => res.json({ ok: true }));
      app.get('/loose/test', (req, res) => res.json({ ok: true }));

      await request(app).get('/strict/test');
      const strictExceeded = await request(app).get('/strict/test');
      expect(strictExceeded.status).toBe(429);

      for (let i = 0; i < 5; i++) {
        await request(app).get('/loose/test');
      }
      const looseExceeded = await request(app).get('/loose/test');
      expect(looseExceeded.status).toBe(429);
    });

    it('should respect custom windowMs', async () => {
      const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
      app.use(limiter);
      app.get('/test', (req, res) => res.json({ ok: true }));

      await request(app).get('/test');
      const res = await request(app).get('/test');
      expect(res.status).toBe(429);
    });

    it('should use custom message', async () => {
      const customMessage = 'Custom rate limit message';
      const limiter = createRateLimiter({ windowMs: 60000, max: 1, message: customMessage });
      app.use(limiter);
      app.get('/test', (req, res) => res.json({ ok: true }));

      await request(app).get('/test');
      const res = await request(app).get('/test');

      expect(res.body.error).toBe(customMessage);
    });
  });

  describe('IP whitelist bypass', () => {
    const WHITELISTED_IP = '10.0.0.100';
    const REGULAR_IP = '192.168.1.1';

    beforeEach(() => {
      removeFromWhitelist(WHITELISTED_IP);
    });

    it('should bypass rate limiting for whitelisted IPs', async () => {
      addToWhitelist(WHITELISTED_IP);
      
      const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
      app.use(limiter);
      app.get('/test', (req, res) => res.json({ ok: true }));

      for (let i = 0; i < 10; i++) {
        const res = await request(app).get('/test').set('X-Forwarded-For', WHITELISTED_IP);
        expect(res.status).toBe(200);
      }
    });

    it('should apply rate limiting to non-whitelisted IPs', async () => {
      addToWhitelist(WHITELISTED_IP);
      
      const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
      app.use(limiter);
      app.get('/test', (req, res) => res.json({ ok: true }));

      await request(app).get('/test').set('X-Forwarded-For', WHITELISTED_IP);
      const whitelistedRes = await request(app).get('/test').set('X-Forwarded-For', WHITELISTED_IP);
      expect(whitelistedRes.status).toBe(200);

      await request(app).get('/test').set('X-Forwarded-For', REGULAR_IP);
      const exceededRes = await request(app).get('/test').set('X-Forwarded-For', REGULAR_IP);
      expect(exceededRes.status).toBe(429);
    });
  });
});
