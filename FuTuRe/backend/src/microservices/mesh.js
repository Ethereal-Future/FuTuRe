/**
 * Service Mesh Integration
 * Integrate with service mesh (Istio, Linkerd)
 */

export class ServiceMesh {
  constructor() {
    this.policies = [];
    this.virtualServices = new Map();
    this.destinationRules = new Map();
  }

  createVirtualService(name, hosts, routes) {
    const vs = {
      name,
      hosts,
      routes: routes.map((r) => ({
        match: r.match || {},
        route: r.route || [],
        timeout: r.timeout || '30s',
        retries: r.retries || { attempts: 3, perTryTimeout: '10s' },
      })),
    };

    this.virtualServices.set(name, vs);
    return vs;
  }

  createDestinationRule(name, host, trafficPolicy = {}) {
    const dr = {
      name,
      host,
      trafficPolicy: {
        connectionPool: trafficPolicy.connectionPool || { tcp: { maxConnections: 100 } },
        loadBalancer: trafficPolicy.loadBalancer || { simple: 'ROUND_ROBIN' },
        outlierDetection: trafficPolicy.outlierDetection || {
          consecutive5xxErrors: 5,
          interval: '30s',
          baseEjectionTime: '30s',
        },
      },
    };

    this.destinationRules.set(name, dr);
    return dr;
  }

  addPolicy(name, type, config) {
    const policy = {
      name,
      type, // 'PeerAuthentication', 'AuthorizationPolicy', etc.
      config,
      createdAt: Date.now(),
    };

    this.policies.push(policy);
    return policy;
  }

  enableMTLS(namespace = 'default') {
    return this.addPolicy(`mtls-${namespace}`, 'PeerAuthentication', {
      namespace,
      mtls: { mode: 'STRICT' },
    });
  }

  enableCircuitBreaker(serviceName, maxConnections = 100, maxRequests = 1000) {
    return this.createDestinationRule(serviceName, serviceName, {
      connectionPool: { tcp: { maxConnections }, http: { http1MaxPendingRequests: maxRequests } },
    });
  }

  getVirtualServices() {
    return Array.from(this.virtualServices.values());
  }

  getDestinationRules() {
    return Array.from(this.destinationRules.values());
  }

  getPolicies() {
    return this.policies;
  }
}

export const createServiceMesh = () => new ServiceMesh();
