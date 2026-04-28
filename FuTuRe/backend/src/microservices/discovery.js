/**
 * Service Discovery
 * Discover and manage service instances
 */

export class ServiceRegistry {
  constructor() {
    this.services = new Map();
    this.instances = new Map();
  }

  registerService(name, config) {
    this.services.set(name, {
      name,
      ...config,
      registeredAt: Date.now(),
    });
    return this;
  }

  registerInstance(serviceName, instanceId, host, port) {
    if (!this.instances.has(serviceName)) {
      this.instances.set(serviceName, []);
    }

    const instance = {
      id: instanceId,
      host,
      port,
      url: `http://${host}:${port}`,
      status: 'healthy',
      registeredAt: Date.now(),
    };

    this.instances.get(serviceName).push(instance);
    return instance;
  }

  deregisterInstance(serviceName, instanceId) {
    const instances = this.instances.get(serviceName) || [];
    const index = instances.findIndex((i) => i.id === instanceId);
    if (index > -1) {
      instances.splice(index, 1);
    }
    return { deregistered: true };
  }

  discoverService(serviceName) {
    return this.services.get(serviceName) || null;
  }

  discoverInstances(serviceName) {
    return this.instances.get(serviceName) || [];
  }

  getHealthyInstance(serviceName) {
    const instances = this.discoverInstances(serviceName);
    const healthy = instances.filter((i) => i.status === 'healthy');
    return healthy.length > 0 ? healthy[Math.floor(Math.random() * healthy.length)] : null;
  }

  updateInstanceHealth(serviceName, instanceId, status) {
    const instances = this.instances.get(serviceName) || [];
    const instance = instances.find((i) => i.id === instanceId);
    if (instance) {
      instance.status = status;
    }
    return instance;
  }

  getRegistry() {
    return {
      services: Array.from(this.services.values()),
      instances: Array.from(this.instances.entries()).map(([name, insts]) => ({
        service: name,
        instances: insts,
      })),
    };
  }
}

export const createServiceRegistry = () => new ServiceRegistry();
