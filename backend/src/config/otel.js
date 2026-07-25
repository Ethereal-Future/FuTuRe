import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { ConsoleSpanExporter, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';

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
