/**
 * Service Boundaries
 * Define and manage microservice boundaries
 */

export class ServiceBoundary {
  constructor(name, version = '1.0.0') {
    this.name = name;
    this.version = version;
    this.endpoints = [];
    this.dependencies = [];
    this.metadata = {};
  }

  addEndpoint(method, path, handler) {
    this.endpoints.push({ method, path, handler });
    return this;
  }

  addDependency(serviceName) {
    if (!this.dependencies.includes(serviceName)) {
      this.dependencies.push(serviceName);
    }
    return this;
  }

  setMetadata(key, value) {
    this.metadata[key] = value;
    return this;
  }

  getDefinition() {
    return {
      name: this.name,
      version: this.version,
      endpoints: this.endpoints.map((e) => ({ method: e.method, path: e.path })),
      dependencies: this.dependencies,
      metadata: this.metadata,
    };
  }

  getEndpoints() {
    return this.endpoints;
  }

  getDependencies() {
    return this.dependencies;
  }
}

export const createServiceBoundary = (name, version) => new ServiceBoundary(name, version);
