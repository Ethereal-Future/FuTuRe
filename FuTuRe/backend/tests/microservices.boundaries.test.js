/**
 * Example: Service Boundaries
 */

import { describe, it, expect } from 'vitest';
import { createServiceBoundary } from '../src/microservices/boundaries.js';

describe('Service Boundaries', () => {
  it('should create service boundary', () => {
    const service = createServiceBoundary('user-service', '1.0.0');

    expect(service.name).toBe('user-service');
    expect(service.version).toBe('1.0.0');
  });

  it('should add endpoints', () => {
    const service = createServiceBoundary('user-service');

    service.addEndpoint('GET', '/users', async () => {});
    service.addEndpoint('POST', '/users', async () => {});

    expect(service.getEndpoints()).toHaveLength(2);
  });

  it('should add dependencies', () => {
    const service = createServiceBoundary('order-service');

    service.addDependency('user-service');
    service.addDependency('payment-service');

    expect(service.getDependencies()).toHaveLength(2);
  });

  it('should get service definition', () => {
    const service = createServiceBoundary('user-service', '1.0.0');
    service.addEndpoint('GET', '/users', async () => {});
    service.addDependency('db-service');

    const def = service.getDefinition();

    expect(def.name).toBe('user-service');
    expect(def.version).toBe('1.0.0');
    expect(def.endpoints).toHaveLength(1);
    expect(def.dependencies).toHaveLength(1);
  });
});
