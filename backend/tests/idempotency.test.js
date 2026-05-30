import { describe, it, expect, beforeEach, vi } from 'vitest';
import { idempotencyMiddleware } from '../src/middleware/idempotency.js';

describe('Idempotency Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {},
      body: { destination: 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B', amount: '100' },
    };
    res = {
      statusCode: 200,
      json: vi.fn(function(data) { return this; }),
      status: vi.fn(function(code) { this.statusCode = code; return this; }),
    };
    next = vi.fn();
  });

  it('should skip idempotency check if no Idempotency-Key header', async () => {
    await idempotencyMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should reject invalid Idempotency-Key format', async () => {
    req.headers['idempotency-key'] = 'invalid@key!';
    await idempotencyMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('should accept valid UUID format', async () => {
    req.headers['idempotency-key'] = '550e8400-e29b-41d4-a716-446655440000';
    await idempotencyMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should return 422 if same key used with different request body', async () => {
    req.headers['idempotency-key'] = 'test-key-123';
    
    // First request
    await idempotencyMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();

    // Simulate response caching
    const originalJson = res.json;
    res.json({ hash: 'tx123' });

    // Second request with different body
    req.body = { destination: 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B', amount: '200' };
    res.status.mockClear();
    res.json.mockClear();
    next.mockClear();

    await idempotencyMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(422);
  });
});
