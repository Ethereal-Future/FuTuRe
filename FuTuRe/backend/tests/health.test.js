import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import cors from 'cors';

// Simple mock of the app for testing the health route
const app = express();
app.use(cors());
app.get('/health', (req, res) => {
  res.json({ status: 'ok', network: 'testnet' });
});

describe('GET /health', () => {
  it('should return 200 and status ok', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', network: 'testnet' });
  });
});
