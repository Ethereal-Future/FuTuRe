import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app, close } from '../src/server.js';
import prisma from '../src/db/client.js';
import { signAccessToken } from '../src/auth/tokens.js';
import logger from '../src/config/logger.js';

vi.mock('../src/config/logger.js');

describe('Issue #559: Account Label Persistence', () => {
  let server;
  let testUser;
  let token;

  beforeAll(async () => {
    server = app;
    testUser = await prisma.user.create({
      data: {
        publicKey: `G${Math.random().toString().slice(2, 56)}`,
      },
    });
    token = signAccessToken(testUser.id);
  });

  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { userId: testUser.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
    await close();
  });

  it('should update account label', async () => {
    const res = await request(server)
      .put('/api/accounts/label')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'My Trading Account' });

    expect(res.status).toBe(200);
    expect(res.body.label).toBe('My Trading Account');
  });

  it('should retrieve account label', async () => {
    await request(server)
      .put('/api/accounts/label')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Test Label' });

    const res = await request(server)
      .get('/api/accounts/label')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.label).toBe('Test Label');
  });

  it('should clear label with empty string', async () => {
    await request(server)
      .put('/api/accounts/label')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Temp Label' });

    const res = await request(server)
      .put('/api/accounts/label')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: '' });

    expect(res.status).toBe(200);
    expect(res.body.label).toBeNull();
  });

  it('should reject labels over 255 characters', async () => {
    const longLabel = 'a'.repeat(256);
    const res = await request(server)
      .put('/api/accounts/label')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: longLabel });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('max 255 characters');
  });

  it('should return null for label when none set', async () => {
    const newUser = await prisma.user.create({
      data: {
        publicKey: `G${Math.random().toString().slice(2, 56)}`,
      },
    });
    const newToken = signAccessToken(newUser.id);

    const res = await request(server)
      .get('/api/accounts/label')
      .set('Authorization', `Bearer ${newToken}`);

    expect(res.status).toBe(200);
    expect(res.body.label).toBeNull();

    await prisma.user.delete({ where: { id: newUser.id } });
  });

  it('should require authentication', async () => {
    const res = await request(server)
      .put('/api/accounts/label')
      .send({ label: 'Test' });

    expect(res.status).toBe(401);
  });

  it('should persist label across multiple updates', async () => {
    const labels = ['First', 'Second', 'Third'];

    for (const label of labels) {
      const res = await request(server)
        .put('/api/accounts/label')
        .set('Authorization', `Bearer ${token}`)
        .send({ label });
      expect(res.status).toBe(200);
    }

    const final = await request(server)
      .get('/api/accounts/label')
      .set('Authorization', `Bearer ${token}`);

    expect(final.body.label).toBe('Third');
  });
});
