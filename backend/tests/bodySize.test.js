import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import axios from 'axios';

describe('Request Body Size Validation', () => {
  let server;
  let app;
  const PORT = 3003;
  const baseURL = `http://localhost:${PORT}`;

  beforeAll(async () => {
    app = express();

    // Global body size limit (1kb)
    app.use(express.json({ limit: '1kb' }));

    // Larger body size limit for specific routes
    const largeBodyLimit = express.json({ limit: '100kb' });

    // Test routes
    app.post('/api/v1/auth/login', (req, res) => {
      res.json({ success: true });
    });

    app.post('/api/v1/backup', largeBodyLimit, (req, res) => {
      res.json({ success: true });
    });

    app.post('/api/v1/compliance', largeBodyLimit, (req, res) => {
      res.json({ success: true });
    });

    // Error handler
    app.use((err, req, res, next) => {
      if (err.status === 413 || err.message.includes('too large')) {
        return res.status(413).json({ error: 'Payload too large' });
      }
      res.status(500).json({ error: err.message });
    });

    return new Promise((resolve) => {
      server = app.listen(PORT, resolve);
    });
  });

  afterAll(() => {
    return new Promise((resolve) => {
      server.close(resolve);
    });
  });

  it('should reject oversized body on global limit endpoint with 413', async () => {
    const largePayload = JSON.stringify({ data: 'x'.repeat(2000) });

    try {
      await axios.post(`${baseURL}/api/v1/auth/login`, JSON.parse(largePayload));
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error.response.status).toBe(413);
    }
  });

  it('should accept small body on global limit endpoint', async () => {
    const response = await axios.post(`${baseURL}/api/v1/auth/login`, { username: 'test' });
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
  });

  it('should accept large body on backup endpoint with 100kb limit', async () => {
    const largePayload = { data: 'x'.repeat(50000) };
    const response = await axios.post(`${baseURL}/api/v1/backup`, largePayload);
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
  });

  it('should reject oversized body on backup endpoint with 413', async () => {
    const largePayload = { data: 'x'.repeat(150000) };

    try {
      await axios.post(`${baseURL}/api/v1/backup`, largePayload);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error.response.status).toBe(413);
    }
  });

  it('should accept large body on compliance endpoint with 100kb limit', async () => {
    const largePayload = { data: 'x'.repeat(50000) };
    const response = await axios.post(`${baseURL}/api/v1/compliance`, largePayload);
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
  });
});
