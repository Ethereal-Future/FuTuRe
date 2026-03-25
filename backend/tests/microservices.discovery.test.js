/**
 * Example: Service Discovery
 */

import { describe, it, expect } from 'vitest';
import { createServiceRegistry } from '../src/microservices/discovery.js';

describe('Service Discovery', () => {
  it('should register service', () => {
    const registry = createServiceRegistry();

    registry.registerService('user-service', { port: 3001 });

    const service = registry.discoverService('user-service');
    expect(service.name).toBe('user-service');
  });

  it('should register service instances', () => {
    const registry = createServiceRegistry();

    registry.registerService('user-service', { port: 3001 });
    registry.registerInstance('user-service', 'instance-1', 'localhost', 3001);
    registry.registerInstance('user-service', 'instance-2', 'localhost', 3002);

    const instances = registry.discoverInstances('user-service');
    expect(instances).toHaveLength(2);
  });

  it('should get healthy instance', () => {
    const registry = createServiceRegistry();

    registry.registerService('user-service', { port: 3001 });
    registry.registerInstance('user-service', 'instance-1', 'localhost', 3001);

    const instance = registry.getHealthyInstance('user-service');
    expect(instance).not.toBeNull();
    expect(instance.status).toBe('healthy');
  });

  it('should deregister instance', () => {
    const registry = createServiceRegistry();

    registry.registerService('user-service', { port: 3001 });
    registry.registerInstance('user-service', 'instance-1', 'localhost', 3001);
    registry.deregisterInstance('user-service', 'instance-1');

    const instances = registry.discoverInstances('user-service');
    expect(instances).toHaveLength(0);
  });

  it('should update instance health', () => {
    const registry = createServiceRegistry();

    registry.registerService('user-service', { port: 3001 });
    registry.registerInstance('user-service', 'instance-1', 'localhost', 3001);
    registry.updateInstanceHealth('user-service', 'instance-1', 'unhealthy');

    const instance = registry.getHealthyInstance('user-service');
    expect(instance).toBeNull();
  });
});
