/**
 * Example: Distributed Tracing
 */

import { describe, it, expect } from 'vitest';
import { createDistributedTracer } from '../src/microservices/tracing.js';

describe('Distributed Tracing', () => {
  it('should start trace', () => {
    const tracer = createDistributedTracer();

    const trace = tracer.startTrace('trace-1', 'user-service');

    expect(trace.id).toBe('trace-1');
    expect(trace.status).toBe('active');
  });

  it('should start and end spans', () => {
    const tracer = createDistributedTracer();

    tracer.startTrace('trace-1', 'user-service');
    tracer.startSpan('trace-1', 'span-1', 'getUser', 'user-service');
    tracer.endSpan('trace-1', 'span-1');

    const trace = tracer.getTrace('trace-1');
    expect(trace.spans).toHaveLength(1);
    expect(trace.spans[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('should add tags to spans', () => {
    const tracer = createDistributedTracer();

    tracer.startTrace('trace-1', 'user-service');
    tracer.startSpan('trace-1', 'span-1', 'getUser', 'user-service');
    tracer.addTag('trace-1', 'span-1', 'userId', '123');

    const trace = tracer.getTrace('trace-1');
    expect(trace.spans[0].tags.userId).toBe('123');
  });

  it('should add logs to spans', () => {
    const tracer = createDistributedTracer();

    tracer.startTrace('trace-1', 'user-service');
    tracer.startSpan('trace-1', 'span-1', 'getUser', 'user-service');
    tracer.addLog('trace-1', 'span-1', 'User found');

    const trace = tracer.getTrace('trace-1');
    expect(trace.spans[0].logs).toHaveLength(1);
  });

  it('should end trace', () => {
    const tracer = createDistributedTracer();

    tracer.startTrace('trace-1', 'user-service');
    tracer.endTrace('trace-1');

    const trace = tracer.getTrace('trace-1');
    expect(trace.status).toBe('completed');
    expect(trace.duration).toBeGreaterThanOrEqual(0);
  });
});
