import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import axios from 'axios';
import healthRoutes from '../src/routes/health.js';

describe('Health Check Endpoints', () => {
  let server;
  let app;
  const PORT = 3004;
  const baseURL = `http://localhost:${PORT}`;

  beforeAll(async () => {
    app = express();
    app.use('/', healthRoutes);

    return new Promise((resolve) => {
      server = app.listen(PORT, resolve);
    });
  });

  afterAll(() => {
    return new Promise((resolve) => {
      server.close(resolve);
    });
  });

  describe('GET /health', () => {
    it('should return health status with all components', async () => {
      const response = await axios.get(`${baseURL}/health`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('status');
      expect(response.data).toHaveProperty('overallHealth');
      expect(response.data).toHaveProperty('timestamp');
      expect(response.data).toHaveProperty('checks');
      expect(response.data).toHaveProperty('dependencies');
      expect(response.data).toHaveProperty('system');
      expect(response.data).toHaveProperty('application');
    });

    it('should include individual component checks', async () => {
      const response = await axios.get(`${baseURL}/health`);
      const checks = response.data.checks;

      expect(checks).toBeInstanceOf(Array);
      expect(checks.length).toBeGreaterThan(0);
      
      // Check for expected components
      const componentNames = checks.map(c => c.name);
      expect(componentNames).toContain('stellar');
      expect(componentNames).toContain('database');
      expect(componentNames).toContain('redis');
      expect(componentNames).toContain('email');
      expect(componentNames).toContain('websocket');
    });

    it('should include dependency information', async () => {
      const response = await axios.get(`${baseURL}/health`);
      const deps = response.data.dependencies;

      expect(deps).toHaveProperty('overall');
      expect(deps).toHaveProperty('dependencies');
      expect(deps.dependencies).toBeInstanceOf(Array);
    });
  });

  describe('GET /health/live', () => {
    it('should return liveness probe status', async () => {
      const response = await axios.get(`${baseURL}/health/live`);
      
      expect(response.status).toBe(200);
      expect(response.data.status).toBe('alive');
      expect(response.data).toHaveProperty('timestamp');
      expect(response.data).toHaveProperty('uptime');
    });
  });

  describe('GET /health/ready', () => {
    it('should return readiness probe status', async () => {
      const response = await axios.get(`${baseURL}/health/ready`);
      
      expect(response.status).toBeOneOf([200, 503]);
      expect(response.data).toHaveProperty('status');
      expect(response.data).toHaveProperty('timestamp');
      expect(response.data).toHaveProperty('checks');
    });

    it('should include all dependency checks in readiness probe', async () => {
      const response = await axios.get(`${baseURL}/health/ready`);
      const checks = response.data.checks;

      expect(checks).toHaveProperty('stellar');
      expect(checks).toHaveProperty('database');
      expect(checks).toHaveProperty('redis');
      expect(checks).toHaveProperty('email');
      expect(checks).toHaveProperty('websocket');
    });
  });

  describe('GET /metrics', () => {
    it('should return system metrics', async () => {
      const response = await axios.get(`${baseURL}/metrics`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('timestamp');
      expect(response.data).toHaveProperty('application');
      expect(response.data).toHaveProperty('system');
      expect(response.data).toHaveProperty('process');
    });

    it('should include memory and CPU metrics', async () => {
      const response = await axios.get(`${baseURL}/metrics`);
      const process = response.data.process;

      expect(process).toHaveProperty('memory');
      expect(process.memory).toHaveProperty('rss');
      expect(process.memory).toHaveProperty('heapUsed');
      expect(process).toHaveProperty('cpuUsage');
    });
  });
});
