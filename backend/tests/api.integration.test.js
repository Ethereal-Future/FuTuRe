import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from './helpers/full-app.js';

describe('API Integration: Auth + User Flows', () => {
  const testUser = {
    username: 'testuser' + Math.floor(Math.random() * 10000),
    password: 'Password123!',
  };

  let accessToken = '';

  it('should register a new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(testUser);

    expect(res.status).toBe(201);
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user.username).toBe(testUser.username);
  });

  it('should login and return access/refresh tokens', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send(testUser);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    accessToken = res.body.accessToken;
  });

  it('should access protected profile with a valid token', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe(testUser.username);
  });

  it('should return 401 for accessing profile without token', async () => {
    const res = await request(app).get('/api/auth/profile');
    expect(res.status).toBe(401);
  });

  it('should return 422 for invalid registration data', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'tu', password: '1' }); // too short

    expect(res.status).toBe(422);
    expect(res.body.errors).toBeInstanceOf(Array);
  });
});

describe('API Integration: Health & Network', () => {
  it('should return health status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
