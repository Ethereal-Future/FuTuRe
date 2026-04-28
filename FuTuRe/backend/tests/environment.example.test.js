/**
 * Example: Using Test Environment Management
 * Demonstrates environment setup and teardown
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnvironment } from '../../testing/environment.js';

describe('Test Environment Management', () => {
  const env = createTestEnvironment({ network: 'testnet' });

  it('should have test environment configured', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.STELLAR_NETWORK).toBe('testnet');
  });

  it('should manage state across tests', () => {
    env.setState('userId', '123');
    expect(env.getState().userId).toBe('123');
  });

  it('should preserve environment variables', () => {
    const state = env.getState();
    expect(state).toHaveProperty('startTime');
  });
});
