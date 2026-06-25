/* backend/tests/streaming.integration.test.js */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock Prisma
const mockStreams = [];
const mockFailures = [];
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

          const updateData = { ...data };

          if (updateData.totalStreamed && typeof updateData.totalStreamed === 'object' && updateData.totalStreamed.increment) {
            mockStreams[index].totalStreamed += updateData.totalStreamed.increment;
            delete updateData.totalStreamed;
          }
          if (updateData.failureCount && typeof updateData.failureCount === 'object' && updateData.failureCount.increment) {
            mockStreams[index].failureCount = (mockStreams[index].failureCount || 0) + updateData.failureCount.increment;
            delete updateData.failureCount;
          }

          Object.assign(mockStreams[index], updateData);

          return Promise.resolve({ ...mockStreams[index], sender: mockUsers[0], recipient: mockUsers[1] });
        }),
        findMany: vi.fn(({ where } = {}) => {
          let results = mockStreams;
          if (where?.status) results = results.filter(s => s.status === where.status);
          return Promise.resolve(results.map(s => ({ ...s, sender: mockUsers[0], recipient: mockUsers[1] })));
        }),
        findUnique: vi.fn(({ where }) => {
          const stream = mockStreams.find(s => s.id === where.id);
          return Promise.resolve(stream ? { ...stream, sender: mockUsers[0], recipient: mockUsers[1] } : null);
        }),
        count: vi.fn(({ where } = {}) => {
          let results = mockStreams;
          if (where?.senderId) results = results.filter(s => s.senderId === where.senderId);
          if (where?.status) results = results.filter(s => s.status === where.status);
          return Promise.resolve(results.length);
        }),
        groupBy: vi.fn(() => Promise.resolve([])),
        aggregate: vi.fn(() => Promise.resolve({ _sum: { totalStreamed: 0 } })),
      },
      streamFailure: {
        create: vi.fn(({ data }) => {
          const failure = { id: 'failure-' + Math.random(), ...data, createdAt: new Date() };
          mockFailures.push(failure);
          return Promise.resolve(failure);
        }),
        findMany: vi.fn(({ where }) => {
          const results = mockFailures.filter(f => f.streamId === where.streamId);
          return Promise.resolve(results.slice().reverse());
        }),
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

// Mock web push
vi.mock('../src/notifications/webPush.js', () => ({
  getSubscriptionByPublicKey: vi.fn(() => ({ endpoint: 'https://push.example.com/sub1' })),
  sendWebPush: vi.fn(() => Promise.resolve({ sent: true })),
  saveSubscription: vi.fn(),
  getSubscription: vi.fn(),
}));

// Mock secrets so worker tests don't require STREAM_SECRET_ENCRYPTION_KEY
vi.mock('../src/config/secrets.js', () => ({
  encryptToEnvValue: vi.fn((val) => `enc:${val}`),
  decryptFromEnvValue: vi.fn((val) => val.replace('enc:', '')),
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
  });
});

describe('Stream failure escalation', () => {
  const { sendPayment } = await import('../src/services/stellar.js');
  const webPush = await import('../src/notifications/webPush.js');

  const STREAM_FAIL_ID     = 'aaaaaaaa-0001-4000-a000-000000000001';
  const STREAM_REASON_ID   = 'aaaaaaaa-0002-4000-a000-000000000002';
  const STREAM_RECORD_ID   = 'aaaaaaaa-0003-4000-a000-000000000003';
  const STREAM_HISTORY_ID  = 'aaaaaaaa-0004-4000-a000-000000000004';
  const STREAM_RESUME_ID   = 'aaaaaaaa-0005-4000-a000-000000000005';

  beforeEach(() => {
    vi.clearAllMocks();
    mockStreams.length = 0;
    mockFailures.length = 0;
  });

  it('marks a stream FAILED after 3 consecutive failures and sends push notification', async () => {
    sendPayment.mockRejectedValue(new Error('insufficient balance'));

    const stream = {
      id: STREAM_FAIL_ID,
      status: 'ACTIVE',
      failureCount: 0,
      lastProcessedAt: new Date(Date.now() - 70000),
      intervalSeconds: 60,
      rateAmount: 1,
      assetCode: 'XLM',
      senderSecret: 'enc:STEST',
      sender: mockUsers[0],
      recipient: mockUsers[1],
      endTime: null,
    };
    mockStreams.push(stream);

    for (let i = 0; i < 3; i++) {
      stream.lastProcessedAt = new Date(Date.now() - 70000);
      await StreamingService.processActiveStreams();
    }

    const finalStream = mockStreams.find(s => s.id === STREAM_FAIL_ID);
    expect(finalStream.status).toBe('FAILED');
    expect(finalStream.failureCount).toBe(3);
    expect(webPush.sendWebPush).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: expect.any(String) }),
      expect.objectContaining({
        title: 'Payment stream failed',
        data: expect.objectContaining({ streamId: STREAM_FAIL_ID }),
      })
    );
  });

  it('includes the failure reason in the push notification', async () => {
    sendPayment.mockRejectedValue(new Error('account not found'));

    const stream = {
      id: STREAM_REASON_ID,
      status: 'ACTIVE',
      failureCount: 2,
      lastProcessedAt: new Date(Date.now() - 70000),
      intervalSeconds: 60,
      rateAmount: 1,
      assetCode: 'XLM',
      senderSecret: 'enc:STEST',
      sender: mockUsers[0],
      recipient: mockUsers[1],
      endTime: null,
    };
    mockStreams.push(stream);

    await StreamingService.processActiveStreams();

    const [, payload] = webPush.sendWebPush.mock.calls[0];
    expect(payload.body).toContain('account not found');
    expect(payload.data.reason).toBe('account not found');
  });

  it('records each failure in StreamFailure table', async () => {
    sendPayment.mockRejectedValue(new Error('tx failed'));

    const stream = {
      id: STREAM_RECORD_ID,
      status: 'ACTIVE',
      failureCount: 0,
      lastProcessedAt: new Date(Date.now() - 70000),
      intervalSeconds: 60,
      rateAmount: 1,
      assetCode: 'XLM',
      senderSecret: 'enc:STEST',
      sender: mockUsers[0],
      recipient: mockUsers[1],
      endTime: null,
    };
    mockStreams.push(stream);

    await StreamingService.processActiveStreams();

    const streamFailures = mockFailures.filter(f => f.streamId === STREAM_RECORD_ID);
    expect(streamFailures).toHaveLength(1);
    expect(streamFailures[0].reason).toBe('tx failed');
  });

  it('GET /api/streaming/:id/failures - returns failure history', async () => {
    const stream = {
      id: STREAM_HISTORY_ID,
      status: 'FAILED',
      failureCount: 3,
      lastProcessedAt: new Date(),
      intervalSeconds: 60,
      rateAmount: 1,
      assetCode: 'XLM',
      senderSecret: null,
      sender: mockUsers[0],
      recipient: mockUsers[1],
      endTime: null,
    };
    mockStreams.push(stream);
    mockFailures.push({ id: 'f1f1f1f1-0001-4000-a000-000000000001', streamId: STREAM_HISTORY_ID, reason: 'error 1', createdAt: new Date() });
    mockFailures.push({ id: 'f1f1f1f1-0002-4000-a000-000000000002', streamId: STREAM_HISTORY_ID, reason: 'error 2', createdAt: new Date() });

    const res = await request(app).get(`/api/streaming/${STREAM_HISTORY_ID}/failures`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('POST /api/streaming/:id/resume - retries a FAILED stream and resets failureCount', async () => {
    const stream = {
      id: STREAM_RESUME_ID,
      status: 'FAILED',
      failureCount: 3,
      lastProcessedAt: new Date(),
      intervalSeconds: 60,
      rateAmount: 1,
      assetCode: 'XLM',
      senderSecret: null,
      sender: mockUsers[0],
      recipient: mockUsers[1],
      endTime: null,
    };
    mockStreams.push(stream);

    const res = await request(app).post(`/api/streaming/${STREAM_RESUME_ID}/resume`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.failureCount).toBe(0);
  });
});

describe('Stream creation rate limiting (#541)', () => {
  const senderKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
  const recipientKey = 'GAK6SGA5S75J3Z3B4S3Z3B4S3Z3B4S3Z3B4S3Z3B4S3Z3B4S3Z3B4S3';

  beforeEach(() => {
    vi.clearAllMocks();
    mockStreams.length = 0;
    mockFailures.length = 0;
    delete process.env.MAX_STREAMS_PER_USER;
    process.env.STREAM_SECRET_ENCRYPTION_KEY = 'test-key-32-chars-xxxxxxxxxxx';
  });

  it('rejects the 11th active stream creation with 429', async () => {
    // Pre-fill 10 active streams for the sender
    for (let i = 0; i < 10; i++) {
      mockStreams.push({
        id: `bbbbbbbb-000${i}-4000-a000-000000000000`,
        senderId: mockUsers[0].id,
        status: 'ACTIVE',
        sender: mockUsers[0],
        recipient: mockUsers[1],
      });
    }

    const res = await request(app).post('/api/streaming').send({
      senderPublicKey: senderKey,
      recipientPublicKey: recipientKey,
      senderSecret: 'SCZANGBA5RLKJNMDBJKTA7LCMNSZXJVLCMSBXOLQXGAEOP7SKNU4PX2',
      rateAmount: 0.1,
      intervalSeconds: 60,
    });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/limit reached/i);
  });

  it('allows the 10th active stream when limit is 10 (default)', async () => {
    for (let i = 0; i < 9; i++) {
      mockStreams.push({
        id: `cccccccc-000${i}-4000-a000-000000000000`,
        senderId: mockUsers[0].id,
        status: 'ACTIVE',
        sender: mockUsers[0],
        recipient: mockUsers[1],
      });
    }

    const res = await request(app).post('/api/streaming').send({
      senderPublicKey: senderKey,
      recipientPublicKey: recipientKey,
      senderSecret: 'SCZANGBA5RLKJNMDBJKTA7LCMNSZXJVLCMSBXOLQXGAEOP7SKNU4PX2',
      rateAmount: 0.1,
      intervalSeconds: 60,
    });

    expect(res.status).toBe(201);
  });

  it('respects MAX_STREAMS_PER_USER env var', async () => {
    process.env.MAX_STREAMS_PER_USER = '2';

    mockStreams.push({
      id: 'dddddddd-0001-4000-a000-000000000001',
      senderId: mockUsers[0].id,
      status: 'ACTIVE',
      sender: mockUsers[0],
      recipient: mockUsers[1],
    });
    mockStreams.push({
      id: 'dddddddd-0002-4000-a000-000000000002',
      senderId: mockUsers[0].id,
      status: 'ACTIVE',
      sender: mockUsers[0],
      recipient: mockUsers[1],
    });

    const res = await request(app).post('/api/streaming').send({
      senderPublicKey: senderKey,
      recipientPublicKey: recipientKey,
      senderSecret: 'SCZANGBA5RLKJNMDBJKTA7LCMNSZXJVLCMSBXOLQXGAEOP7SKNU4PX2',
      rateAmount: 0.1,
      intervalSeconds: 60,
    });

    expect(res.status).toBe(429);
  });
});
