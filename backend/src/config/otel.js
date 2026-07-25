import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { ConsoleSpanExporter, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

export function initializeOTel() {
  const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const resource = Resource.default().merge(
    new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: 'future-backend',
      [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    })
  );

  const exporter = otelEndpoint
    ? new OTLPTraceExporter({
        url: otelEndpoint,
      })
    : new ConsoleSpanExporter();

  const sdk = new NodeSDK({
    resource,
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  console.log('[OTEL] Initialized with endpoint:', otelEndpoint || 'console');

  return sdk;
}

/**
 * Run an async operation inside a named span.
 * Automatically sets span status to ERROR and records exceptions on throw.
 *
 * @param {string} tracerName  - logical tracer name, e.g. 'stellar-service'
 * @param {string} spanName    - human-readable span name, e.g. 'horizon.submitTransaction'
 * @param {(span: import('@opentelemetry/api').Span) => Promise<T>} fn
 * @param {import('@opentelemetry/api').SpanOptions} [options]
 * @returns {Promise<T>}
 */
export async function withSpan(tracerName, spanName, fn, options = {}) {
  const tracer = trace.getTracer(tracerName);
  return tracer.startActiveSpan(spanName, options, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Returns the active trace/span IDs for the current async context.
 * Useful for correlating logs with traces.
 *
 * @returns {{ traceId: string|undefined, spanId: string|undefined }}
 */
export function getCurrentTraceIds() {
  const span = trace.getActiveSpan();
  if (!span) return { traceId: undefined, spanId: undefined };
  const ctx = span.spanContext();
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}
