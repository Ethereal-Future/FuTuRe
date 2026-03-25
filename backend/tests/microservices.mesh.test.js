/**
 * Example: Service Mesh
 */

import { describe, it, expect } from 'vitest';
import { createServiceMesh } from '../src/microservices/mesh.js';

describe('Service Mesh', () => {
  it('should create virtual service', () => {
    const mesh = createServiceMesh();

    const vs = mesh.createVirtualService('user-service', ['user-service'], [
      { route: [{ destination: { host: 'user-service' } }] },
    ]);

    expect(vs.name).toBe('user-service');
    expect(vs.routes).toHaveLength(1);
  });

  it('should create destination rule', () => {
    const mesh = createServiceMesh();

    const dr = mesh.createDestinationRule('user-service', 'user-service');

    expect(dr.name).toBe('user-service');
    expect(dr.trafficPolicy).toBeDefined();
  });

  it('should enable mTLS', () => {
    const mesh = createServiceMesh();

    const policy = mesh.enableMTLS('default');

    expect(policy.type).toBe('PeerAuthentication');
    expect(policy.config.mtls.mode).toBe('STRICT');
  });

  it('should enable circuit breaker', () => {
    const mesh = createServiceMesh();

    const dr = mesh.enableCircuitBreaker('user-service', 100, 1000);

    expect(dr.trafficPolicy.connectionPool).toBeDefined();
  });

  it('should get all virtual services', () => {
    const mesh = createServiceMesh();

    mesh.createVirtualService('user-service', ['user-service'], []);
    mesh.createVirtualService('order-service', ['order-service'], []);

    const services = mesh.getVirtualServices();
    expect(services).toHaveLength(2);
  });

  it('should get all policies', () => {
    const mesh = createServiceMesh();

    mesh.enableMTLS('default');
    mesh.addPolicy('auth', 'AuthorizationPolicy', {});

    const policies = mesh.getPolicies();
    expect(policies).toHaveLength(2);
  });
});
