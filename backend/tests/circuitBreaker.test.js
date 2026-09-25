import { describe, it, expect, beforeEach } from 'vitest';
import { createCircuitBreaker } from '../src/services/circuitBreaker.js';

describe('CircuitBreaker', () => {
  let breaker;

  beforeEach(() => {
    breaker = createCircuitBreaker('test-service');
  });

  it('should isolate failures between separate instances', async () => {
    const breaker1 = createCircuitBreaker('service-1');
    const breaker2 = createCircuitBreaker('service-2');

    // Fail breaker1 5 times
    for (let i = 0; i < 5; i++) {
      try {
        await breaker1.call(() => Promise.reject(new Error('fail')));
      } catch (e) {
        // Expected
      }
    }

    // Breaker1 should be open
    const state1 = breaker1.getState();
    expect(state1.state).toBe('OPEN');

    // Breaker2 should still be closed
    const state2 = breaker2.getState();
    expect(state2.state).toBe('CLOSED');
  });

  it('should allow independent instances to track failures separately', async () => {
    const batchBreaker = createCircuitBreaker('batch-job');
    const interactiveBreaker = createCircuitBreaker('interactive');

    // Simulate batch failures
    for (let i = 0; i < 3; i++) {
      try {
        await batchBreaker.call(() => Promise.reject(new Error('batch error')));
      } catch {
        // Expected
      }
    }

    // Interactive should still work and not be affected
    const result = await interactiveBreaker.call(() => Promise.resolve('ok'));
    expect(result).toBe('ok');

    // Batch should have 3 failures but not yet open
    const batchState = batchBreaker.getState();
    expect(batchState.failures).toBe(3);
    expect(batchState.state).toBe('CLOSED');
  });

  it('should reset independently per instance', async () => {
    const breaker1 = createCircuitBreaker('service-1');
    const breaker2 = createCircuitBreaker('service-2');

    // Open breaker1
    for (let i = 0; i < 5; i++) {
      try {
        await breaker1.call(() => Promise.reject(new Error('fail')));
      } catch (e) {}
    }

    expect(breaker1.getState().state).toBe('OPEN');

    // Reset only breaker1
    breaker1.reset();

    expect(breaker1.getState().state).toBe('CLOSED');
    expect(breaker1.getState().failures).toBe(0);

    // breaker2 should not be affected
    expect(breaker2.getState().state).toBe('CLOSED');
  });

  it('should track failures within the window', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.call(() => Promise.reject(new Error('fail')));
      } catch {}
    }

    const state = breaker.getState();
    expect(state.failures).toBe(3);
    expect(state.state).toBe('CLOSED');
  });

  it('should open circuit after failure threshold', async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await breaker.call(() => Promise.reject(new Error('fail')));
      } catch {}
    }

    const state = breaker.getState();
    expect(state.state).toBe('OPEN');
    expect(state.failures).toBe(5);
  });

  it('should fail fast when open', async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await breaker.call(() => Promise.reject(new Error('fail')));
      } catch {}
    }

    expect(breaker.getState().state).toBe('OPEN');

    try {
      await breaker.call(() => Promise.resolve('should not execute'));
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.circuitOpen).toBe(true);
      expect(err.message).toContain('circuit breaker is open');
    }
  });

  it('should reset on successful call', async () => {
    // Fail twice, then succeed
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.call(() => Promise.reject(new Error('fail')));
      } catch {}
    }

    expect(breaker.getState().failures).toBe(2);

    // Successful call should reset
    await breaker.call(() => Promise.resolve('success'));

    const state = breaker.getState();
    expect(state.failures).toBe(0);
    expect(state.state).toBe('CLOSED');
  });
});
