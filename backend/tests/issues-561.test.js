import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app, close } from '../src/server.js';
import prisma from '../src/db/client.js';
import logger from '../src/config/logger.js';

vi.mock('../src/config/logger.js');

describe('Issue #561: Transaction Search and Filtering', () => {
  let server;
  let testUser1, testUser2;
  let testTransactions;

  beforeAll(async () => {
    server = app;

    testUser1 = await prisma.user.create({
      data: { publicKey: `G${Math.random().toString().slice(2, 56)}` }
    });

    testUser2 = await prisma.user.create({
      data: { publicKey: `G${Math.random().toString().slice(2, 56)}` }
    });

    // Create test transactions
    const now = new Date();
    testTransactions = await Promise.all([
      prisma.transaction.create({
        data: {
          hash: 'a'.repeat(64),
          senderId: testUser1.id,
          recipientId: testUser2.id,
          amount: 10,
          assetCode: 'XLM',
          successful: true,
          memo: 'Invoice #001',
        }
      }),
      prisma.transaction.create({
        data: {
          hash: 'b'.repeat(64),
          senderId: testUser1.id,
          recipientId: testUser2.id,
          amount: 50,
          assetCode: 'USDC',
          successful: true,
          memo: 'Payment for services',
        }
      }),
      prisma.transaction.create({
        data: {
          hash: 'c'.repeat(64),
          senderId: testUser1.id,
          recipientId: testUser2.id,
          amount: 100,
          assetCode: 'XLM',
          successful: false,
        }
      }),
    ]);
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { senderId: testUser1.id } });
    await prisma.user.deleteMany({ where: { id: { in: [testUser1.id, testUser2.id] } } });
    await close();
  });

  it('should filter transactions by asset code', async () => {
    const res = await request(server)
      .get(`/api/transactions/${testUser1.publicKey}`)
      .query({ assetCode: 'XLM' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('should filter transactions by date range', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const res = await request(server)
      .get(`/api/transactions/${testUser1.publicKey}`)
      .query({
        from: yesterday.toISOString(),
        to: tomorrow.toISOString()
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('should filter transactions by amount range', async () => {
    const res = await request(server)
      .get(`/api/transactions/${testUser1.publicKey}`)
      .query({
        minAmount: 40,
        maxAmount: 60
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('should search transactions by memo', async () => {
    const res = await request(server)
      .get(`/api/transactions/${testUser1.publicKey}/search`)
      .query({ search: 'Invoice' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('should combine multiple filters', async () => {
    const res = await request(server)
      .get(`/api/transactions/${testUser1.publicKey}`)
      .query({
        assetCode: 'XLM',
        minAmount: 5,
        maxAmount: 50
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('should support limit parameter', async () => {
    const res = await request(server)
      .get(`/api/transactions/${testUser1.publicKey}`)
      .query({ limit: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
  });

  it('should enforce max limit of 100', async () => {
    const res = await request(server)
      .get(`/api/transactions/${testUser1.publicKey}`)
      .query({ limit: 500 });

    expect(res.status).toBe(200);
    expect(res.body.pageSize).toBeLessThanOrEqual(100);
  });

  it('should support deprecated startTime/endTime params', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const res = await request(server)
      .get(`/api/transactions/${testUser1.publicKey}`)
      .query({
        startTime: yesterday.toISOString(),
        endTime: now.toISOString()
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('should support deprecated asset param', async () => {
    const res = await request(server)
      .get(`/api/transactions/${testUser1.publicKey}`)
      .query({ asset: 'XLM' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
