/**
 * Distributed Tracing
 * Track requests across services
 */

export class DistributedTracer {
  constructor() {
    this.traces = new Map();
    this.spans = [];
  }

  startTrace(traceId, serviceName) {
    const trace = {
      id: traceId,
      startTime: Date.now(),
      serviceName,
      spans: [],
      status: 'active',
    };

    this.traces.set(traceId, trace);
    return trace;
  }

  startSpan(traceId, spanId, operationName, serviceName) {
    const span = {
      traceId,
      spanId,
      operationName,
      serviceName,
      startTime: Date.now(),
      endTime: null,
      duration: null,
      tags: {},
      logs: [],
    };

    this.spans.push(span);

    const trace = this.traces.get(traceId);
    if (trace) {
      trace.spans.push(span);
    }

    return span;
  }

  endSpan(traceId, spanId) {
    const span = this.spans.find((s) => s.traceId === traceId && s.spanId === spanId);
    if (span) {
      span.endTime = Date.now();
      span.duration = span.endTime - span.startTime;
    }
    return span;
  }

  addTag(traceId, spanId, key, value) {
    const span = this.spans.find((s) => s.traceId === traceId && s.spanId === spanId);
    if (span) {
      span.tags[key] = value;
    }
  }

  addLog(traceId, spanId, message) {
    const span = this.spans.find((s) => s.traceId === traceId && s.spanId === spanId);
    if (span) {
      span.logs.push({ timestamp: Date.now(), message });
    }
  }

  endTrace(traceId) {
    const trace = this.traces.get(traceId);
    if (trace) {
      trace.endTime = Date.now();
      trace.duration = trace.endTime - trace.startTime;
      trace.status = 'completed';
    }
    return trace;
  }

  getTrace(traceId) {
    return this.traces.get(traceId) || null;
  }

  getAllTraces() {
    return Array.from(this.traces.values());
  }
}

export const createDistributedTracer = () => new DistributedTracer();
