import * as Otlp from '@effect/opentelemetry/Otlp'
import { layer as FetchHttpClientLayer } from '@effect/platform/FetchHttpClient'
import { Config, Effect, Layer } from 'effect'

/**
 * Observability layer that exports traces, metrics, and logs to OTEL-LGTM
 * using Effect's native OTLP exporter.
 */
export const ObservabilityLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const baseUrl = yield* Config.string('OTEL_EXPORTER_OTLP_ENDPOINT')
    const serviceName = yield* Config.string('OTEL_SERVICE_NAME')
    
    return Otlp.layer({
      baseUrl,
      resource: { serviceName },
    }).pipe(Layer.provide(FetchHttpClientLayer))
  }),
)