/**
 * Example: API Gateway
 */

import { describe, it, expect } from 'vitest';
import { createServiceRegistry, createAPIGateway } from '../src/microservices/index.js';

describe('API Gateway', () => {
  it('should add routes', () => {
    const registry = createServiceRegistry();
    const gateway = createAPIGateway(registry);

    gateway.addRoute('/users', 'user-service', 'GET');
    gateway.addRoute('/orders', 'order-service', 'GET');

    expect(gateway.getRoutes()).toHaveLength(2);
  });

  it('should route requests', async () => {
    const registry = createServiceRegistry();
    registry.registerService('user-service', { port: 3001 });
    registry.registerInstance('user-service', 'instance-1', 'localhost', 3001);

    const gateway = createAPIGateway(registry);
    gateway.addRoute('/users', 'user-service', 'GET');

    const result = await gateway.route('/users', 'GET', {});

    expect(result.status).toBe(200);
    expect(result.service).toBe('user-service');
  });

  it('should handle missing routes', async () => {
    const registry = createServiceRegistry();
    const gateway = createAPIGateway(registry);

    const result = await gateway.route('/unknown', 'GET', {});

    expect(result.status).toBe(404);
  });

  it('should add middleware', async () => {
    const registry = createServiceRegistry();
    registry.registerService('user-service', { port: 3001 });
    registry.registerInstance('user-service', 'instance-1', 'localhost', 3001);

    const gateway = createAPIGateway(registry);
    gateway.addRoute('/users', 'user-service', 'GET');

    gateway.addMiddleware(async (path, method, data) => {
      if (path === '/admin') {
        return { blocked: true, reason: 'Unauthorized' };
      }
      return { blocked: false };
    });

    const result = await gateway.route('/users', 'GET', {});
    expect(result.status).toBe(200);
  });

  it('should set rate limits', () => {
    const registry = createServiceRegistry();
    const gateway = createAPIGateway(registry);

    gateway.setRateLimit('user-service', 100);

    expect(gateway.rateLimits.get('user-service')).toBe(100);
  });
});
