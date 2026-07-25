import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import healthRoutes from '../src/routes/health.js';
import * as dbClient from '../src/db/client.js';

vi.mock('../src/db/client.js');
vi.mock('../src/services/stellar.js');

describe('GET /health', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(healthRoutes);
  });

  it('should return 200 OK when database is healthy', async () => {
    vi.mocked(dbClient.checkDBHealth).mockResolvedValue({ status: 'ok' });

    const res = await new Promise((resolve) => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn((data) => resolve({ status: mockRes.status.mock.calls[0][0], data })),
      };
      const mockReq = {};
      
      healthRoutes.stack[0].route.stack[0].handle(mockReq, mockRes);
    });

    expect(res.status).toBe(200);
    expect(res.data.status).toBe('healthy');
  });

  it('should return 503 when database is unreachable', async () => {
    vi.mocked(dbClient.checkDBHealth).mockResolvedValue({ 
      status: 'error', 
      error: 'Connection refused' 
    });

    const res = await new Promise((resolve) => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn((data) => resolve({ status: mockRes.status.mock.calls[0][0], data })),
      };
      const mockReq = {};
      
      healthRoutes.stack[0].route.stack[0].handle(mockReq, mockRes);
    });

    expect(res.status).toBe(503);
    expect(res.data.status).toBe('unhealthy');
  });
});
