/**
 * Test Environment Management
 * Setup and teardown for test environments
 */

import { beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

export class TestEnvironment {
  constructor(config = {}) {
    this.config = {
      network: 'testnet',
      port: 3001,
      ...config,
    };
    this.state = {};
  }

  async setup() {
    this.state.startTime = Date.now();
    this.state.env = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.STELLAR_NETWORK = this.config.network;
  }

  async teardown() {
    process.env = this.state.env;
    this.state = {};
  }

  getState() {
    return this.state;
  }

  setState(key, value) {
    this.state[key] = value;
  }
}

export const createTestEnvironment = (config = {}) => {
  const env = new TestEnvironment(config);

  beforeAll(async () => {
    await env.setup();
  });

  afterAll(async () => {
    await env.teardown();
  });

  return env;
};

export const withTestEnvironment = (fn, config = {}) => {
  return async () => {
    const env = new TestEnvironment(config);
    await env.setup();
    try {
      return await fn(env);
    } finally {
      await env.teardown();
    }
  };
};
