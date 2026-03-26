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
  }

  addRoute(path, serviceName, method = 'GET') {
    this.routes.set(path, { serviceName, method });
    return this;
  }

  addMiddleware(fn) {
    this.middleware.push(fn);
    return this;
  }

  setRateLimit(serviceName, requestsPerSecond) {
    this.rateLimits.set(serviceName, requestsPerSecond);
    return this;
  }

  async route(path, method, data) {
    const route = this.routes.get(path);
    if (!route) {
      return { status: 404, error: 'Route not found' };
    }

    // Apply middleware
    for (const mw of this.middleware) {
      const result = await mw(path, method, data);
      if (result.blocked) {
        return { status: 403, error: result.reason };
      }
    }

    // Check rate limit
    const limit = this.rateLimits.get(route.serviceName);
    if (limit && !this.checkRateLimit(route.serviceName, limit)) {
      return { status: 429, error: 'Rate limit exceeded' };
    }

    // Route to service
    const instance = this.registry.getHealthyInstance(route.serviceName);
    if (!instance) {
      return { status: 503, error: 'Service unavailable' };
    }

    return {
      status: 200,
      service: route.serviceName,
      instance: instance.url,
      data,
    };
  }

  checkRateLimit(serviceName, limit) {
    // Simplified rate limiting
    return true;
  }

  getRoutes() {
    return Array.from(this.routes.entries()).map(([path, config]) => ({
      path,
      ...config,
    }));
  }
}

export const createAPIGateway = (registry) => new APIGateway(registry);
