import { describe, expect, it } from 'vitest';
import { createAPIGateway, createServiceRegistry } from '../src/microservices/index.js';

function createGatewayWithService() {
  const registry = createServiceRegistry();
  registry.registerService('catalog-service', { port: 3002 });
  registry.registerInstance('catalog-service', 'inst-1', 'localhost', 3002);
  return createAPIGateway(registry);
}

describe('Enterprise APIGateway', () => {
  it('supports versioning and lifecycle management', async () => {
    const gateway = createGatewayWithService();
    gateway.addRoute('/catalog/items', 'catalog-service', 'GET', { version: 'v2', lifecycle: 'active' });
    gateway.registerAPI('catalog', {
      versions: { v2: { status: 'active' } },
    });

    const routed = await gateway.route('/catalog/items', 'GET', {}, { version: 'v2' });
    expect(routed.status).toBe(200);
    expect(gateway.deprecateVersion('catalog', 'v2', '2026-12-31')).toBe(true);
  });

  it('supports advanced rate limiting strategies', () => {
    const gateway = createGatewayWithService();
    gateway.setRateLimit('catalog-service', {
      strategy: 'sliding-window',
      limit: 2,
      windowMs: 1000,
    });

    expect(gateway.checkRateLimit('catalog-service', gateway.rateLimits.get('catalog-service'), 'client-a')).toBe(true);
    expect(gateway.checkRateLimit('catalog-service', gateway.rateLimits.get('catalog-service'), 'client-a')).toBe(true);
    expect(gateway.checkRateLimit('catalog-service', gateway.rateLimits.get('catalog-service'), 'client-a')).toBe(false);
  });

  it('collects analytics and monitoring metrics', async () => {
    const gateway = createGatewayWithService();
    gateway.addRoute('/catalog/items', 'catalog-service', 'GET', { version: 'v1' });
    await gateway.route('/catalog/items', 'GET', {}, { version: 'v1' });

    const analytics = gateway.getAnalytics();
    expect(analytics.totalRequests).toBe(1);
    expect(analytics.byStatus[200]).toBe(1);
  });

  it('creates automated API documentation from registered routes', () => {
    const gateway = createGatewayWithService();
    gateway.addRoute('/catalog/items', 'catalog-service', 'GET', { version: 'v1', tags: ['catalog'] });
    const docs = gateway.generateDocumentation();

    expect(docs.openapi).toBe('3.1.0');
    expect(docs.paths['/catalog/items'].get['x-api-version']).toBe('v1');
  });

  it('blocks unsafe payloads through security scanning', () => {
    const gateway = createGatewayWithService();
    const result = gateway.runSecurityScan({ query: '<script>alert(1)</script>' });
    expect(result.safe).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('applies cache strategy for repeated requests', async () => {
    const gateway = createGatewayWithService();
    gateway.setCacheStrategy('catalog-service', { ttlMs: 10000 });
    gateway.addRoute('/catalog/items', 'catalog-service', 'GET', { version: 'v1' });

    const first = await gateway.route('/catalog/items', 'GET', { q: 'xlm' }, { version: 'v1' });
    const second = await gateway.route('/catalog/items', 'GET', { q: 'xlm' }, { version: 'v1' });

    expect(first.status).toBe(200);
    expect(second.cache).toBe('hit');
  });

  it('supports request and response transformation', async () => {
    const gateway = createGatewayWithService();
    gateway.addRoute('/catalog/items', 'catalog-service', 'POST', {
      version: 'v1',
      transformRequest: (data) => ({ ...data, normalized: true }),
      transformResponse: (data) => ({ wrapped: data }),
    });

    const routed = await gateway.route('/catalog/items', 'POST', { symbol: 'xlm' }, { version: 'v1' });
    expect(routed.data.wrapped.normalized).toBe(true);
  });

  it('supports API marketplace listings and plans', () => {
    const gateway = createGatewayWithService();
    gateway.addRoute('/catalog/items', 'catalog-service', 'GET', {
      version: 'v1',
      public: true,
      product: 'catalog',
      tags: ['marketplace'],
    });
    gateway.registerMarketplacePlan('pro', { requestsPerMinute: 500, burst: 50, pricePerMonth: 49 });
    gateway.assignApiKey('api-key-1', 'pro');

    const listing = gateway.listMarketplaceAPIs();
    expect(listing).toHaveLength(1);
    expect(listing[0].product).toBe('catalog');
  });
});