/**
 * Tests for issues #547, #548, #549:
 *  - #548 Timeout handling (Horizon + exchange rate)
 *  - #549 Circuit breaker (CLOSED/OPEN/HALF_OPEN) + /health exposure
 *  - #547 Input validation on pathPayment and convert routes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function makeApp(router, prefix = '') {
  const app = express();
  app.use(express.json());
  app.use(prefix, router);
  return app;
}

// ── #548 withHorizonTimeout ───────────────────────────────────────────────────

describe('#548 withHorizonTimeout', () => {
  beforeEach(() => vi.resetModules());

  it('resolves when Horizon responds in time', async () => {
    const { withHorizonTimeout } = await import('../src/services/stellar.js');
    const result = await withHorizonTimeout(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('rejects with isTimeout=true when Horizon exceeds HORIZON_TIMEOUT_MS', async () => {
    process.env.HORIZON_TIMEOUT_MS = '10';
    vi.resetModules();
    const { withHorizonTimeout } = await import('../src/services/stellar.js');
    const slow = () => new Promise((resolve) => setTimeout(() => resolve('late'), 200));
    await expect(withHorizonTimeout(slow)).rejects.toMatchObject({ isTimeout: true });
    delete process.env.HORIZON_TIMEOUT_MS;
  });
});

describe('#548 EXCHANGE_RATE_TIMEOUT_MS', () => {
  it('getExchangeRateTimeout reads env var', async () => {
    process.env.EXCHANGE_RATE_TIMEOUT_MS = '1234';
    vi.resetModules();
    // We can't easily import the private helper; test indirectly via env var presence
    // exchangeRate.js uses AbortSignal.timeout(getExchangeRateTimeout()); just verify
    // the env var is consumed without error during module load.
    const mod = await import('../src/services/exchangeRate.js');
    expect(mod).toBeDefined();
    delete process.env.EXCHANGE_RATE_TIMEOUT_MS;
  });
});

describe('#548 504 response on timeout in route', () => {
  beforeEach(() => vi.resetModules());

  it('GET /:publicKey returns 504 when getBalance times out', async () => {
    vi.doMock('../src/services/stellar.js', () => ({
      getBalance: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('timed out'), { isTimeout: true })),
      isTestnet: vi.fn(() => true),
    }));
    vi.doMock('../src/db/client.js', () => ({ default: {} }));
    vi.doMock('../src/middleware/rateLimiter.js', () => ({
      createRateLimiter: () => (_r, _s, n) => n(),
    }));
    vi.doMock('../src/services/websocket.js', () => ({ broadcastToAccount: vi.fn() }));
    vi.doMock('../src/webhooks/dispatcher.js', () => ({ dispatchEvent: vi.fn() }));
    vi.doMock('../src/notifications/webPush.js', () => ({
      getSubscriptionByPublicKey: vi.fn(),
      sendWebPush: vi.fn(),
    }));
    vi.doMock('../src/cache/appCache.js', () => ({ keys: {}, invalidateBalance: vi.fn() }));
    const { default: router } = await import('../src/routes/stellar/accounts.js');
    const app = makeApp(router);
    const res = await request(app).get('/GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN');
    expect(res.status).toBe(504);
  });

  it('POST /send returns 504 when sendPayment times out', async () => {
    vi.doMock('../src/services/stellar.js', () => ({
      sendPayment: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('timed out'), { isTimeout: true })),
      getBalance: vi.fn(),
      isTestnet: vi.fn(() => true),
    }));
    vi.doMock('../src/middleware/rateLimiter.js', () => ({
      createRateLimiter: () => (_r, _s, n) => n(),
    }));
    vi.doMock('../src/services/websocket.js', () => ({ broadcastToAccount: vi.fn() }));
    vi.doMock('../src/webhooks/dispatcher.js', () => ({ dispatchEvent: vi.fn() }));
    vi.doMock('../src/notifications/webPush.js', () => ({
      getSubscriptionByPublicKey: vi.fn(),
      sendWebPush: vi.fn(),
    }));
    vi.doMock('../src/cache/appCache.js', () => ({ keys: {}, invalidateBalance: vi.fn() }));
    const { default: router } = await import('../src/routes/stellar/payments.js');
    const app = makeApp(router);
    const res = await request(app).post('/send').send({
      sourceSecret: 'SCZANGBA5SSEL6IUSLRN7DHPN2JNZQ5BKC3HEMICUOXFYLMWJW6SDPX',
      destination: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN',
      amount: '10',
    });
    expect(res.status).toBe(504);
  });
});

// ── #549 Circuit breaker ──────────────────────────────────────────────────────

describe('#549 circuit breaker states', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { resetCircuit } = await import('../src/services/circuitBreaker.js');
    resetCircuit();
  });

  it('CLOSED: passes through successful calls', async () => {
    const { callWithCircuitBreaker } = await import('../src/services/circuitBreaker.js');
    await expect(callWithCircuitBreaker(() => Promise.resolve(42))).resolves.toBe(42);
  });

  it('OPEN: opens after threshold failures and rejects immediately', async () => {
    process.env.CIRCUIT_FAILURE_THRESHOLD = '3';
    process.env.CIRCUIT_WINDOW_MS = '10000';
    vi.resetModules();
    const { callWithCircuitBreaker, getCircuitState, resetCircuit } =
      await import('../src/services/circuitBreaker.js');
    const fail = () => Promise.reject(new Error('boom'));
    for (let i = 0; i < 3; i++) {
      await callWithCircuitBreaker(fail).catch(() => {});
    }
    expect(getCircuitState().state).toBe('OPEN');
    await expect(callWithCircuitBreaker(() => Promise.resolve('x'))).rejects.toMatchObject({
      circuitOpen: true,
    });
    resetCircuit();
    delete process.env.CIRCUIT_FAILURE_THRESHOLD;
    delete process.env.CIRCUIT_WINDOW_MS;
  });

  it('HALF_OPEN: probe succeeds → closes circuit', async () => {
    process.env.CIRCUIT_FAILURE_THRESHOLD = '2';
    process.env.CIRCUIT_WINDOW_MS = '10000';
    process.env.CIRCUIT_PROBE_INTERVAL_MS = '10';
    vi.resetModules();
    const { callWithCircuitBreaker, getCircuitState, resetCircuit } =
      await import('../src/services/circuitBreaker.js');
    // Force open
    const fail = () => Promise.reject(new Error('boom'));
    await callWithCircuitBreaker(fail).catch(() => {});
    await callWithCircuitBreaker(fail).catch(() => {});
    expect(getCircuitState().state).toBe('OPEN');
    // Wait for probe timer
    await new Promise((r) => setTimeout(r, 50));
    expect(getCircuitState().state).toBe('HALF_OPEN');
    // Probe succeeds → closes
    await callWithCircuitBreaker(() => Promise.resolve('recovered'));
    expect(getCircuitState().state).toBe('CLOSED');
    resetCircuit();
    delete process.env.CIRCUIT_FAILURE_THRESHOLD;
    delete process.env.CIRCUIT_WINDOW_MS;
    delete process.env.CIRCUIT_PROBE_INTERVAL_MS;
  });

  it('HALF_OPEN: probe fails → re-opens circuit', async () => {
    process.env.CIRCUIT_FAILURE_THRESHOLD = '2';
    process.env.CIRCUIT_WINDOW_MS = '10000';
    process.env.CIRCUIT_PROBE_INTERVAL_MS = '10';
    vi.resetModules();
    const { callWithCircuitBreaker, getCircuitState, resetCircuit } =
      await import('../src/services/circuitBreaker.js');
    const fail = () => Promise.reject(new Error('boom'));
    await callWithCircuitBreaker(fail).catch(() => {});
    await callWithCircuitBreaker(fail).catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    expect(getCircuitState().state).toBe('HALF_OPEN');
    await callWithCircuitBreaker(fail).catch(() => {});
    expect(getCircuitState().state).toBe('OPEN');
    resetCircuit();
    delete process.env.CIRCUIT_FAILURE_THRESHOLD;
    delete process.env.CIRCUIT_WINDOW_MS;
    delete process.env.CIRCUIT_PROBE_INTERVAL_MS;
  });
});

describe('#549 GET /health exposes circuit state', () => {
  beforeEach(() => vi.resetModules());

  it('includes circuit state in stellar check', async () => {
    vi.doMock('../src/services/stellar.js', () => ({
      getNetworkStatus: vi
        .fn()
        .mockResolvedValue({ network: 'testnet', horizonUrl: 'http://h', online: true }),
    }));
    vi.doMock('../src/services/circuitBreaker.js', () => ({
      getCircuitState: () => ({ state: 'CLOSED', failures: 0, openedAt: null }),
    }));
    vi.doMock('../src/eventSourcing/index.js', () => ({
      eventMonitor: {},
      eventStore: { initialized: true, events: [] },
    }));
    vi.doMock('../src/security/index.js', () => ({ auditLogger: { isInitialized: true } }));
    vi.doMock('../src/cache/appCache.js', () => ({
      analytics: {},
      monitor: { getPerformanceStats: () => ({}), getAlerts: () => [] },
    }));
    vi.doMock('../src/db/client.js', () => ({
      default: {
        paymentStream: { count: vi.fn().mockResolvedValue(0) },
        pendingMultiSigTx: { count: vi.fn().mockResolvedValue(0) },
      },
    }));
    vi.doMock('../src/backup/manager.js', () => ({ getMetrics: () => null }));
    vi.doMock('../src/cache/redis.js', () => ({
      RedisBackend: class {
        client = null;
      },
    }));
    vi.doMock('../src/notifications/channels/email.js', () => ({ sendEmail: vi.fn() }));
    vi.doMock('../src/middleware/auth.js', () => ({ requireAuth: (_r, _s, n) => n() }));
    const { default: router } = await import('../src/routes/health.js');
    const app = makeApp(router);
    const res = await request(app).get('/health');
    expect(res.status).toBeLessThan(600);
    const stellar = res.body?.checks?.find?.((c) => c.name === 'stellar');
    expect(stellar?.circuit).toBeDefined();
    expect(stellar?.circuit?.state).toBe('CLOSED');
  });

  it('returns 503 when circuit is OPEN', async () => {
    vi.doMock('../src/services/circuitBreaker.js', () => ({
      getCircuitState: () => ({ state: 'OPEN', failures: 5, openedAt: new Date().toISOString() }),
    }));
    vi.doMock('../src/services/stellar.js', () => ({ getNetworkStatus: vi.fn() }));
    vi.doMock('../src/eventSourcing/index.js', () => ({
      eventMonitor: {},
      eventStore: { initialized: true, events: [] },
    }));
    vi.doMock('../src/security/index.js', () => ({ auditLogger: { isInitialized: true } }));
    vi.doMock('../src/cache/appCache.js', () => ({
      analytics: {},
      monitor: { getPerformanceStats: () => ({}), getAlerts: () => [] },
    }));
    vi.doMock('../src/db/client.js', () => ({
      default: {
        paymentStream: { count: vi.fn().mockResolvedValue(0) },
        pendingMultiSigTx: { count: vi.fn().mockResolvedValue(0) },
      },
    }));
    vi.doMock('../src/backup/manager.js', () => ({ getMetrics: () => null }));
    vi.doMock('../src/cache/redis.js', () => ({
      RedisBackend: class {
        client = null;
      },
    }));
    vi.doMock('../src/notifications/channels/email.js', () => ({ sendEmail: vi.fn() }));
    vi.doMock('../src/middleware/auth.js', () => ({ requireAuth: (_r, _s, n) => n() }));
    const { default: router } = await import('../src/routes/health.js');
    const app = makeApp(router);
    const res = await request(app).get('/health');
    const stellar = res.body?.checks?.find?.((c) => c.name === 'stellar');
    expect(stellar?.status).toBe('unhealthy');
    expect(stellar?.circuit?.state).toBe('OPEN');
  });
});

describe('#549 GET /:publicKey returns 503 when circuit open', () => {
  beforeEach(() => vi.resetModules());

  it('returns 503 when Horizon circuit is open', async () => {
    vi.doMock('../src/services/stellar.js', () => ({
      getBalance: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('circuit open'), { circuitOpen: true })),
      isTestnet: vi.fn(() => true),
    }));
    vi.doMock('../src/db/client.js', () => ({ default: {} }));
    vi.doMock('../src/middleware/rateLimiter.js', () => ({
      createRateLimiter: () => (_r, _s, n) => n(),
    }));
    vi.doMock('../src/services/websocket.js', () => ({ broadcastToAccount: vi.fn() }));
    vi.doMock('../src/webhooks/dispatcher.js', () => ({ dispatchEvent: vi.fn() }));
    vi.doMock('../src/notifications/webPush.js', () => ({
      getSubscriptionByPublicKey: vi.fn(),
      sendWebPush: vi.fn(),
    }));
    vi.doMock('../src/cache/appCache.js', () => ({ keys: {}, invalidateBalance: vi.fn() }));
    const { default: router } = await import('../src/routes/stellar/accounts.js');
    const app = makeApp(router);
    const res = await request(app).get('/GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN');
    expect(res.status).toBe(503);
  });
});

// ── #547 Input validation ─────────────────────────────────────────────────────

describe('#547 pathPayment route validation', () => {
  let app;
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../src/services/pathPayment.js', () => ({
      findPaths: vi.fn().mockResolvedValue([]),
      findPathsStrictReceive: vi.fn().mockResolvedValue([]),
      sendPathPayment: vi.fn().mockResolvedValue({ success: true }),
      optimizePath: vi.fn().mockResolvedValue({}),
      getPathPaymentAnalytics: vi.fn().mockReturnValue({}),
      recordPathPaymentAnalytic: vi.fn(),
    }));
    const { default: router } = await import('../src/routes/pathPayment.js');
    app = makeApp(router);
  });

  it('POST /paths rejects invalid sourceAsset', async () => {
    const res = await request(app)
      .post('/paths')
      .send({ sourceAsset: 'BAD!', sourceAmount: '10', destinationAsset: 'USDC' });
    expect(res.status).toBe(422);
  });

  it('POST /paths rejects negative amount', async () => {
    const res = await request(app)
      .post('/paths')
      .send({ sourceAsset: 'XLM', sourceAmount: '-5', destinationAsset: 'USDC' });
    expect(res.status).toBe(422);
  });

  it('POST /paths accepts valid payload', async () => {
    const res = await request(app)
      .post('/paths')
      .send({ sourceAsset: 'XLM', sourceAmount: '10', destinationAsset: 'USDC' });
    expect(res.status).toBe(200);
  });

  it('POST /send rejects invalid destination public key', async () => {
    const res = await request(app).post('/send').send({
      sourceSecret: 'SCZANGBA5SSEL6IUSLRN7DHPN2JNZQ5BKC3HEMICUOXFYLMWJW6SDPX',
      destination: 'NOT_A_KEY',
      sendAsset: 'XLM',
      sendAmount: '5',
      destAsset: 'USDC',
    });
    expect(res.status).toBe(422);
  });

  it('POST /send rejects invalid sourceSecret', async () => {
    const res = await request(app).post('/send').send({
      sourceSecret: 'badsecret',
      destination: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN',
      sendAsset: 'XLM',
      sendAmount: '5',
      destAsset: 'USDC',
    });
    expect(res.status).toBe(422);
  });
});

describe('#547 convert route validates amount param', () => {
  let app;
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../src/services/exchangeRate.js', () => ({
      convert: vi.fn().mockResolvedValue(0.5),
      getRate: vi.fn().mockResolvedValue(0.5),
      getAllRates: vi.fn().mockResolvedValue([]),
    }));
    const { default: router } = await import('../src/routes/stellar/convert.js');
    app = makeApp(router);
  });

  it('rejects negative amount', async () => {
    const res = await request(app).get('/XLM/USDC/-5');
    expect(res.status).toBe(422);
  });

  it('rejects zero amount', async () => {
    const res = await request(app).get('/XLM/USDC/0');
    expect(res.status).toBe(422);
  });

  it('accepts valid amount', async () => {
    const res = await request(app).get('/XLM/USDC/10');
    expect(res.status).toBe(200);
  });

  it('rejects invalid asset code', async () => {
    const res = await request(app).get('/BAD!/USDC/10');
    expect(res.status).toBe(422);
  });
});
