import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('future-backend', '1.0.0');

export class DistributedTracer {
  constructor() {
    this.traces = new Map();
    this.spans = [];
  }

  startTrace(traceId, serviceName) {
    const traceEntry = {
      id: traceId,
      startTime: Date.now(),
      serviceName,
      spans: [],
      status: 'active',
    };

    this.traces.set(traceId, traceEntry);
    return traceEntry;
  }

  startSpan(traceId, spanId, operationName, serviceName) {
    const otelSpan = tracer.startSpan(operationName, {
      attributes: {
        'service.name': serviceName,
        'trace.id': traceId,
        'span.id': spanId,
      },
    });

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
      otelSpan,
    };

    this.spans.push(span);

    const traceEntry = this.traces.get(traceId);
    if (traceEntry) {
      traceEntry.spans.push(span);
    }

    return span;
  }

  endSpan(traceId, spanId) {
    const span = this.spans.find((s) => s.traceId === traceId && s.spanId === spanId);
    if (span) {
      span.endTime = Date.now();
      span.duration = span.endTime - span.startTime;
      if (span.otelSpan) {
        span.otelSpan.end();
      }
    }
    return span;
  }

  addTag(traceId, spanId, key, value) {
    const span = this.spans.find((s) => s.traceId === traceId && s.spanId === spanId);
    if (span) {
      span.tags[key] = value;
      if (span.otelSpan) {
        span.otelSpan.setAttribute(key, value);
      }
    }
  }

  addLog(traceId, spanId, message) {
    const span = this.spans.find((s) => s.traceId === traceId && s.spanId === spanId);
    if (span) {
      span.logs.push({ timestamp: Date.now(), message });
      if (span.otelSpan) {
        span.otelSpan.addEvent('log', { message });
      }
    }
  }

  endTrace(traceId) {
    const traceEntry = this.traces.get(traceId);
    if (traceEntry) {
      traceEntry.endTime = Date.now();
      traceEntry.duration = traceEntry.endTime - traceEntry.startTime;
      traceEntry.status = 'completed';
    }
    return traceEntry;
  }

  getTrace(traceId) {
    return this.traces.get(traceId) || null;
  }

  getAllTraces() {
    return Array.from(this.traces.values());
  }
}

export const createDistributedTracer = () => new DistributedTracer();

export { tracer };
