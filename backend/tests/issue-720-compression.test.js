import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import axios from 'axios';
import express from 'express';
import compression from 'compression';
import { createServer } from 'http';

describe('#720 - HTTP Response Compression', () => {
  let server;
  const port = 3007;
  const baseURL = `http://localhost:${port}`;

  beforeAll(async () => {
    const app = express();

    // Apply compression middleware before routes (as in the actual server)
    app.use(compression({
      filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
      },
      level: 6,
    }));

    // Test endpoint returning JSON data
    app.get('/api/test/data', (req, res) => {
      const largeData = {
        records: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `Transaction ${i}`,
          amount: Math.random() * 1000,
          timestamp: new Date().toISOString(),
          status: 'success',
          hash: '0x' + Math.random().toString(36).substring(7),
          details: 'Lorem ipsum dolor sit amet consectetur adipiscing elit',
        })),
        metadata: {
          total: 100,
          page: 1,
          pageSize: 100,
        },
      };
      res.json(largeData);
    });

    server = createServer(app);
    await new Promise((resolve, reject) => {
      server.listen(port, () => resolve()).catch(reject);
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('should compress JSON responses with gzip', async () => {
    const response = await axios.get(`${baseURL}/api/test/data`, {
      headers: { 'Accept-Encoding': 'gzip, deflate' },
      validateStatus: () => true,
    });

    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.status).toBe(200);
  });

  it('should include Content-Encoding header for compressed responses', async () => {
    const response = await axios.get(`${baseURL}/api/test/data`, {
      headers: { 'Accept-Encoding': 'gzip' },
      validateStatus: () => true,
    });

    expect(['gzip', 'deflate']).toContain(response.headers['content-encoding']);
  });

  it('should not compress when x-no-compression header is set', async () => {
    const response = await axios.get(`${baseURL}/api/test/data`, {
      headers: {
        'Accept-Encoding': 'gzip',
        'x-no-compression': 'true',
      },
      validateStatus: () => true,
    });

    expect(response.headers['content-encoding']).toBeUndefined();
  });

  it('should reduce payload size significantly', async () => {
    const response = await axios.get(`${baseURL}/api/test/data`, {
      headers: { 'Accept-Encoding': 'gzip' },
      validateStatus: () => true,
    });

    const contentLength = parseInt(response.headers['content-length'], 10);
    const dataSize = JSON.stringify(response.data).length;

    // Compression should reduce size to < 30% of original
    const ratio = contentLength / dataSize;
    expect(ratio).toBeLessThan(0.3);
  });

  it('should auto-decompress in axios automatically', async () => {
    const response = await axios.get(`${baseURL}/api/test/data`);

    expect(response.data).toHaveProperty('records');
    expect(response.data.records).toBeInstanceOf(Array);
    expect(response.data.records.length).toBe(100);
  });
});
