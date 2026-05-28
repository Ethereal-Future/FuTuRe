/**
 * API Gateway
 * Central entry point for all service requests
 */

export class APIGateway {
  constructor(registry) {
    this.registry = registry;
    this.routes = new Map();
    this.middleware = [];
    this.rateLimits = new Map();
    this.rateState = new Map();
    this.analytics = {
      totalRequests: 0,
      totalErrors: 0,
      byStatus: {},
      byRoute: {},
      totalLatencyMs: 0,
    };
    this.apiCatalog = new Map();
    this.cache = new Map();
    this.cacheStrategies = new Map();
    this.marketplacePlans = new Map();
    this.apiKeys = new Map();
  }

  addRoute(path, serviceName, method = 'GET', options = {}) {
    const version = options.version || 'v1';
    const key = this._routeKey(path, method, version);
    this.routes.set(key, {
      path,
      serviceName,
      method,
      version,
      lifecycle: options.lifecycle || 'active',
      transformRequest: options.transformRequest,
      transformResponse: options.transformResponse,
      public: options.public ?? false,
      tags: options.tags || [],
      product: options.product || null,
      cacheTtlMs: options.cacheTtlMs || 0,
    });
    return this;
  }

  addMiddleware(fn) {
    this.middleware.push(fn);
    return this;
  }

  setRateLimit(serviceName, config) {
    if (typeof config === 'number') {
      this.rateLimits.set(serviceName, {
        strategy: 'fixed-window',
        limit: config,
        windowMs: 1000,
      });
      return this;
    }

    this.rateLimits.set(serviceName, {
      strategy: config?.strategy || 'fixed-window',
      limit: config?.limit ?? 100,
      windowMs: config?.windowMs ?? 60000,
      capacity: config?.capacity ?? config?.limit ?? 100,
      refillPerSec: config?.refillPerSec ?? Math.ceil((config?.limit ?? 100) / 60),
    });
    return this;
  }

  registerAPI(productName, definition) {
    this.apiCatalog.set(productName, {
      productName,
      owner: definition.owner || 'platform',
      versions: definition.versions || {},
      visibility: definition.visibility || 'private',
      pricing: definition.pricing || null,
    });
    return this;
  }

  deprecateVersion(productName, version, sunsetDate) {
    const product = this.apiCatalog.get(productName);
    if (!product || !product.versions[version]) return false;
    product.versions[version].status = 'deprecated';
    product.versions[version].sunsetDate = sunsetDate;
    return true;
  }

  setCacheStrategy(serviceName, strategy) {
    this.cacheStrategies.set(serviceName, {
      type: strategy?.type || 'ttl',
      ttlMs: strategy?.ttlMs ?? 1000,
    });
    return this;
  }

  registerMarketplacePlan(planName, config) {
    this.marketplacePlans.set(planName, {
      name: planName,
      requestsPerMinute: config?.requestsPerMinute ?? 60,
      burst: config?.burst ?? 10,
      pricePerMonth: config?.pricePerMonth ?? 0,
    });
    return this;
  }

  assignApiKey(apiKey, planName) {
    if (!this.marketplacePlans.has(planName)) {
      throw new Error(`Unknown plan: ${planName}`);
    }
    this.apiKeys.set(apiKey, planName);
    return this;
  }

  listMarketplaceAPIs() {
    return Array.from(this.routes.values())
      .filter(route => route.public)
      .map(route => ({
        path: route.path,
        method: route.method,
        version: route.version,
        tags: route.tags,
        product: route.product,
      }));
  }

  async route(path, method, data, context = {}) {
    const started = Date.now();
    const route = this._findRoute(path, method, context.version || 'v1');
    if (!route) {
      return { status: 404, error: 'Route not found' };
    }

    if (route.lifecycle === 'retired') {
      return { status: 410, error: 'API version retired' };
    }

    const security = this.runSecurityScan(data);
    if (!security.safe) {
      this._recordAnalytics({ path, method, version: route.version }, 400, Date.now() - started);
      return { status: 400, error: 'Payload failed security scan', findings: security.findings };
    }

    // Apply middleware
    for (const mw of this.middleware) {
      const result = await mw(path, method, data, context);
      if (result.blocked) {
        this._recordAnalytics({ path, method, version: route.version }, 403, Date.now() - started);
        return { status: 403, error: result.reason };
      }
    }

    // Check rate limit
    const limit = this.rateLimits.get(route.serviceName);
    const identity = context.apiKey || context.userId || 'anonymous';
    if (limit && !this.checkRateLimit(route.serviceName, limit, identity)) {
      this._recordAnalytics({ path, method, version: route.version }, 429, Date.now() - started);
      return { status: 429, error: 'Rate limit exceeded' };
    }

    const cacheHit = this._readCache(route, path, method, data, context);
    if (cacheHit) {
      this._recordAnalytics({ path, method, version: route.version }, 200, Date.now() - started);
      return { ...cacheHit, cache: 'hit' };
    }

    const transformedData = route.transformRequest ? route.transformRequest(data, context) : data;

    // Route to service
    const instance = this.registry.getHealthyInstance(route.serviceName);
    if (!instance) {
      this._recordAnalytics({ path, method, version: route.version }, 503, Date.now() - started);
      return { status: 503, error: 'Service unavailable' };
    }

    const response = {
      status: 200,
      service: route.serviceName,
      instance: instance.url,
      version: route.version,
      data: route.transformResponse
        ? route.transformResponse(transformedData, context)
        : transformedData,
    };

    this._writeCache(route, path, method, data, context, response);
    this._recordAnalytics({ path, method, version: route.version }, 200, Date.now() - started);
    return response;
  }

  checkRateLimit(serviceName, config, identity = 'anonymous') {
    const key = `${serviceName}:${identity}`;
    const now = Date.now();
    const current = this.rateState.get(key) || {
      count: 0,
      resetAt: now + (config.windowMs || 1000),
      tokens: config.capacity ?? config.limit,
      updatedAt: now,
      history: [],
    };

    if (config.strategy === 'token-bucket') {
      const elapsedSec = Math.max(0, (now - current.updatedAt) / 1000);
      current.tokens = Math.min(config.capacity, current.tokens + (elapsedSec * config.refillPerSec));
      current.updatedAt = now;
      if (current.tokens < 1) {
        this.rateState.set(key, current);
        return false;
      }
      current.tokens -= 1;
      this.rateState.set(key, current);
      return true;
    }

    if (config.strategy === 'sliding-window') {
      const windowStart = now - config.windowMs;
      current.history = current.history.filter(ts => ts >= windowStart);
      if (current.history.length >= config.limit) {
        this.rateState.set(key, current);
        return false;
      }
      current.history.push(now);
      this.rateState.set(key, current);
      return true;
    }

    if (now > current.resetAt) {
      current.count = 0;
      current.resetAt = now + config.windowMs;
    }
    current.count += 1;
    this.rateState.set(key, current);
    return current.count <= config.limit;
  }

  runSecurityScan(payload) {
    const body = JSON.stringify(payload || {}).toLowerCase();
    const signatures = ['<script', '$where', 'drop table', '../'];
    const findings = signatures.filter(signature => body.includes(signature));
    return { safe: findings.length === 0, findings };
  }

  generateDocumentation() {
    const paths = {};
    for (const route of this.routes.values()) {
      const method = route.method.toLowerCase();
      if (!paths[route.path]) paths[route.path] = {};
      paths[route.path][method] = {
        summary: `${route.serviceName} (${route.version})`,
        tags: route.tags,
        deprecated: route.lifecycle === 'deprecated',
        'x-api-version': route.version,
      };
    }
    return {
      openapi: '3.1.0',
      info: { title: 'Gateway APIs', version: '1.0.0' },
      paths,
    };
  }

  getAnalytics() {
    return {
      ...this.analytics,
      avgLatencyMs: this.analytics.totalRequests === 0
        ? 0
        : this.analytics.totalLatencyMs / this.analytics.totalRequests,
    };
  }

  _routeKey(path, method, version) {
    return `${method.toUpperCase()}:${version}:${path}`;
  }

  _findRoute(path, method, version) {
    return this.routes.get(this._routeKey(path, method, version))
      || this.routes.get(this._routeKey(path, method, 'v1'))
      || this.routes.get(this._routeKey(path, method, 'latest'))
      || this.routes.get(this._routeKey(path, method, 'default'))
      || this.routes.get(this._routeKey(path, method, undefined))
      || this.routes.get(path);
  }

  _cacheKey(path, method, data, context, version) {
    return `${method.toUpperCase()}:${version}:${path}:${JSON.stringify(data)}:${context.apiKey || ''}`;
  }

  _readCache(route, path, method, data, context) {
    const strategy = this.cacheStrategies.get(route.serviceName);
    const ttlMs = route.cacheTtlMs || strategy?.ttlMs;
    if (!ttlMs) return null;
    const key = this._cacheKey(path, method, data, context, route.version);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.response;
  }

  _writeCache(route, path, method, data, context, response) {
    const strategy = this.cacheStrategies.get(route.serviceName);
    const ttlMs = route.cacheTtlMs || strategy?.ttlMs;
    if (!ttlMs) return;
    const key = this._cacheKey(path, method, data, context, route.version);
    this.cache.set(key, {
      expiresAt: Date.now() + ttlMs,
      response,
    });
  }

  _recordAnalytics(routeRef, status, latencyMs) {
    this.analytics.totalRequests += 1;
    if (status >= 400) this.analytics.totalErrors += 1;
    this.analytics.byStatus[status] = (this.analytics.byStatus[status] ?? 0) + 1;
    const routeKey = `${routeRef.method}:${routeRef.version}:${routeRef.path}`;
    this.analytics.byRoute[routeKey] = (this.analytics.byRoute[routeKey] ?? 0) + 1;
    this.analytics.totalLatencyMs += latencyMs;
  }

  getRoutes() {
    return Array.from(this.routes.values()).map(config => ({ ...config }));
  }
}

export const createAPIGateway = (registry) => new APIGateway(registry);
