import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/**
 * Minimal OpenTelemetry bootstrap for `client-gateway` -- see
 * `organization-microservice/src/shared/otel/tracing.ts` for the full
 * rationale (no auto-instrumentation meta-package; console exporter).
 */
const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'client-gateway',
  }),
  traceExporter: new ConsoleSpanExporter(),
});

export function startTracing(): void {
  sdk.start();
}

export function shutdownTracing(): Promise<void> {
  return sdk.shutdown();
}
