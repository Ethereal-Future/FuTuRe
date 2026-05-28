/* backend/tests/streaming.integration.test.js */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Mock Prisma
const mockStreams = [];
const mockUsers = [
  { id: 'user-1', publicKey: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H' },
  { id: 'user-2', publicKey: 'GAK6SGA5S75J3Z3B4S3Z3B4S3Z3B4S3Z3B4S3Z3B4S3Z3B4S3Z3B4S3' }
];

vi.mock('../src/db/client.js', () => {
  return {
    default: {
      user: {
        upsert: vi.fn(({ where }) => {
          const user = mockUsers.find(u => u.publicKey === where.publicKey);
          return Promise.resolve(user || { id: 'new-user', publicKey: where.publicKey });
        }),
        findUnique: vi.fn(({ where }) => {
          const user = mockUsers.find(u => u.publicKey === where.publicKey);
          return Promise.resolve(user);
        }),
      },
      paymentStream: {
        create: vi.fn(({ data }) => {
          const stream = { 
            id: 'stream-' + Math.random(), 
            ...data, 
            totalStreamed: 0, 
            lastProcessedAt: new Date(),
            sender: mockUsers[0],
            recipient: mockUsers[1]
          };
          mockStreams.push(stream);
          return Promise.resolve(stream);
        }),
        update: vi.fn(({ where, data }) => {
          const index = mockStreams.findIndex(s => s.id === where.id);
          if (index === -1) return Promise.reject(new Error('Not found'));
          
          if (data.totalStreamed && data.totalStreamed.increment) {
             mockStreams[index].totalStreamed += data.totalStreamed.increment;
          }
          
          Object.assign(mockStreams[index], data);
          // If data has totalStreamed as an object, it might have overwritten the number, fix it:
          if (typeof mockStreams[index].totalStreamed === 'object') {
             // Already handled increment above
          }
          
          return Promise.resolve({ ...mockStreams[index], sender: mockUsers[0], recipient: mockUsers[1] });
        }),
        findMany: vi.fn(() => Promise.resolve(mockStreams.map(s => ({ ...s, sender: mockUsers[0], recipient: mockUsers[1] })))),
        findUnique: vi.fn(({ where }) => Promise.resolve(mockStreams.find(s => s.id === where.id))),
      },
      $transaction: vi.fn((cb) => cb()),
    }
  };
});

// Mock Stellar payment
vi.mock('../src/services/stellar.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sendPayment: vi.fn(() => Promise.resolve({ success: true, hash: 'test-hash-' + Math.random() })),
  };
});

// Mock event sourcing
vi.mock('../src/eventSourcing/index.js', () => ({
  eventMonitor: {
    publishEvent: vi.fn(() => Promise.resolve({})),
    initialize: vi.fn(() => Promise.resolve()),
  },
}));

// Import app AFTER mocks
const { default: app } = await import('./helpers/full-app.js');
const StreamingService = await import('../src/services/streaming.js');

describe('Streaming Payments Integration', () => {
  const senderKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
  const recipientKey = 'GAK6SGA5S75J3Z3B4S3Z3B4S3Z3B4S3Z3B4S3Z3B4S3Z3B4S3Z3B4S3';

  it('POST /api/streaming - creates a new payment stream', async () => {
    const res = await request(app)
      .post('/api/streaming')
      .send({
        senderPublicKey: senderKey,
        recipientPublicKey: recipientKey,
        rateAmount: 0.1,
        intervalSeconds: 60,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.status).toBe('ACTIVE');
  });

  it('POST /api/streaming/:id/pause - pauses an active stream', async () => {
    const streamId = mockStreams[0].id;
    const res = await request(app).post(`/api/streaming/${streamId}/pause`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PAUSED');
  });

  it('POST /api/streaming/:id/resume - resumes a paused stream', async () => {
    const streamId = mockStreams[0].id;
    const res = await request(app).post(`/api/streaming/${streamId}/resume`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('Worker processing - sends payments for active streams', async () => {
    const stream = mockStreams[0];
    
    // Force lastProcessedAt to be in the past to trigger the worker
    stream.lastProcessedAt = new Date(Date.now() - 70000); // 70 seconds ago
    stream.status = 'ACTIVE';

    await StreamingService.processActiveStreams('S-MOCK-SECRET');

    expect(stream.totalStreamed).toBeGreaterThan(0);
    expect(stream.failureCount).toBe(0);
  });

  it('GET /api/streaming/analytics - returns aggregated stream data', async () => {
    const res = await request(app).get('/api/streaming/analytics');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalVolume');
    expect(res.body).toHaveProperty('activeStreams');
    expect(parseFloat(res.body.totalVolume)).toBeGreaterThan(0);
  });
});
