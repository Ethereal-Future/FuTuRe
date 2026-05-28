/**
 * Property-based security tests.
 * Verifies that the API rejects malicious/malformed inputs for all inputs in a class.
 */

import * as fc from 'fast-check';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';

vi.mock('../backend/src/services/stellar.js', () => ({
  createAccount: vi.fn().mockResolvedValue({ publicKey: 'GABC', secretKey: 'SABC' }),
  getBalance: vi.fn().mockResolvedValue({ publicKey: 'GABC', balances: [] }),
  sendPayment: vi.fn().mockResolvedValue({ hash: 'h', successful: true }),
  getFeeStats: vi.fn().mockResolvedValue({}),
  getNetworkStatus: vi.fn().mockResolvedValue({ online: true }),
  getTransactions: vi.fn().mockResolvedValue({ records: [] }),
  createTrustline: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../backend/src/eventSourcing/index.js', () => ({
  eventMonitor: { publishEvent: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../backend/src/db/client.js', () => ({ default: {} }));
vi.mock('../backend/src/services/websocket.js', () => ({ broadcastToAccount: vi.fn() }));
vi.mock('../backend/src/webhooks/dispatcher.js', () => ({ dispatchEvent: vi.fn() }));

let app;
beforeAll(async () => {
  const mod = await import('../backend/tests/helpers/app.js');
  app = mod.default;
});

// Common injection payloads
const injectionStrings = fc.constantFrom(
  "'; DROP TABLE users; --",
  '<script>alert(1)</script>',
  '../../../etc/passwd',
  '${7*7}',
  '{{7*7}}',
  '\x00\x01\x02',
  'A'.repeat(10000),
  '{"$gt": ""}',
  '%00',
  '\n\rHTTP/1.1 200 OK\n\n'
);

describe('Security — injection & oversized input rejection', () => {
  it('always returns 422 for injection strings as publicKey', async () => {
    await fc.assert(
      fc.asyncProperty(injectionStrings, async (payload) => {
        const res = await request(app).get(`/api/stellar/account/${encodeURIComponent(payload)}`);
        expect(res.status).toBe(422);
      })
    );
  });

  it('always returns 422 for injection strings as sourceSecret', async () => {
    await fc.assert(
      fc.asyncProperty(injectionStrings, async (payload) => {
        const res = await request(app)
          .post('/api/stellar/payment/send')
          .send({ sourceSecret: payload, destination: 'G' + 'A'.repeat(55), amount: '1' });
        expect(res.status).toBe(422);
      })
    );
  });

  it('always returns 422 for oversized amount strings', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 21, maxLength: 200 }).filter(s => /\d/.test(s)),
        async (bigAmount) => {
          const res = await request(app)
            .post('/api/stellar/payment/send')
            .send({
              sourceSecret: 'S' + 'A'.repeat(55),
              destination: 'G' + 'A'.repeat(55),
              amount: bigAmount,
            });
          expect(res.status).toBe(422);
        }
      ),
      { numRuns: 20 }
    );
  });
});
