/**
 * API Testing Framework
 * Contract validation, mocking, performance assertions, and reporting
 */

export class ApiTestFramework {
  constructor(app, options = {}) {
    this.app = app;
    this.baseUrl = options.baseUrl ?? '';
    this.contracts = new Map();
    this.mocks = new Map();
    this.results = [];
  }

  /** Register a JSON-Schema-lite contract for an endpoint */
  defineContract(name, { method, path, requestSchema, responseSchema, statusCode = 200 }) {
    this.contracts.set(name, { method, path, requestSchema, responseSchema, statusCode });
  }

  /** Register a mock response for a path */
  mock(path, response) {
    this.mocks.set(path, response);
    return this;
  }

  /** Validate an object against a simple schema { required[], types{} } */
  _validate(obj, schema) {
    if (!schema) return { valid: true, errors: [] };
    const errors = [];
    (schema.required ?? []).forEach((key) => {
      if (obj[key] === undefined) errors.push(`Missing required field: ${key}`);
    });
    Object.entries(schema.types ?? {}).forEach(([key, type]) => {
      if (obj[key] !== undefined && typeof obj[key] !== type) {
        errors.push(`Field "${key}" expected ${type}, got ${typeof obj[key]}`);
      }
    });
    return { valid: errors.length === 0, errors };
  }

  /** Validate a response body against a registered contract */
  validateContract(name, responseBody) {
    const contract = this.contracts.get(name);
    if (!contract) throw new Error(`No contract registered for "${name}"`);
    return this._validate(responseBody, contract.responseSchema);
  }

  /** Record a test result */
  record(name, passed, meta = {}) {
    this.results.push({ name, passed, ...meta, timestamp: new Date().toISOString() });
  }

  /** Assert response time is within budget (ms) */
  assertPerformance(durationMs, budgetMs, label = '') {
    const passed = durationMs <= budgetMs;
    this.record(`perf:${label}`, passed, { durationMs, budgetMs });
    return passed;
  }

  /** Generate a summary report */
  report() {
    const failed = this.results.filter((r) => !r.passed);
    return {
      total: this.results.length,
      passed: this.results.length - failed.length,
      failed: failed.length,
      failures: failed,
      timestamp: new Date().toISOString(),
    };
  }
}

export const createApiFramework = (app, options) => new ApiTestFramework(app, options);
