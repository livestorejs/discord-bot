import { Effect, Schedule, Schema } from 'effect'

/**
 * Connect with exponential backoff retry
 */
export const withExponentialBackoff = <A, E>(
  connectEffect: Effect.Effect<A, E>,
  maxAttempts: number = 5,
  baseDelay: string = '1 second',
  maxDelay: string = '30 seconds',
): Effect.Effect<A, E> => {
  const schedule = Schedule.exponential(baseDelay as any).pipe(
    Schedule.either(Schedule.spaced(maxDelay as any)),
    Schedule.compose(Schedule.recurs(maxAttempts - 1)),
    Schedule.jittered, // Add jitter to prevent thundering herd
  )

  return connectEffect.pipe(Effect.retry(schedule), Effect.withSpan('connection-with-backoff'))
}

/**
 * Handle disconnection with reconnection
 */
export const handleDisconnection = <A, E>(
  reconnectEffect: Effect.Effect<A, E>,
  reason?: string,
  delay: string = '2 seconds',
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    yield* Effect.log(`🔌 Connection lost${reason ? `: ${reason}` : ''}`)
    yield* Effect.sleep(delay as any)
    yield* Effect.log('🔄 Attempting to reconnect...')
    return yield* withExponentialBackoff(reconnectEffect)
  })

/**
 * Create a resilient connection with health monitoring
 */
export const createResilientConnection = <A, E>(
  connectEffect: Effect.Effect<A, E>,
  healthCheck: (connection: A) => Effect.Effect<boolean>,
  onHealthCheckFail?: () => Effect.Effect<void>,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const connection = yield* withExponentialBackoff(connectEffect)

    // Start health monitoring in background
    yield* Effect.forkDaemon(
      Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep('60 seconds' as any)

          const isHealthy = yield* healthCheck(connection).pipe(Effect.catchAll(() => Effect.succeed(false)))

          if (!isHealthy) {
            yield* Effect.log('🏥 Health check failed')
            if (onHealthCheckFail) {
              yield* onHealthCheckFail()
            }
            break
          }
        }
      }),
    )

    return connection
  })

/**
 * Handle Discord close codes according to their documentation
 */
export const shouldReconnect = (closeCode: number): boolean => {
  switch (closeCode) {
    // Reconnectable close codes
    case 1000: // Normal closure
    case 1001: // Going away
    case 1006: // Abnormal closure
    case 4000: // Unknown error
    case 4001: // Unknown opcode
    case 4002: // Decode error
    case 4005: // Already authenticated
    case 4008: // Rate limited
    case 4009: // Session timed out
    case 4003: // Not authenticated
    case 4007: // Invalid seq
    case 4010: // Invalid shard
    case 4011: // Sharding required
    case 4012: // Invalid API version
    case 4013: // Invalid intent(s)
    case 4014: // Disallowed intent(s)
      return true

    // Fatal errors - don't reconnect
    case 4004: // Authentication failed
      return false

    default:
      // Unknown close code - try to reconnect
      return true
  }
}

/**
 * Get appropriate delay for Discord reconnection
 */
export const getReconnectDelay = (closeCode: number): string => {
  switch (closeCode) {
    case 4008: // Rate limited
      return '10 seconds'
    case 4009: // Session timed out
      return '5 seconds'
    default:
      return '2 seconds'
  }
}

/**
 * Check if session can be resumed based on close code
 */
export const canResumeSession = (closeCode: number): boolean => {
  switch (closeCode) {
    case 4007: // Invalid seq
    case 4009: // Session timed out
      return false
    case 4003: // Not authenticated
    case 4010: // Invalid shard
    case 4011: // Sharding required
    case 4012: // Invalid API version
    case 4013: // Invalid intent(s)
    case 4014: // Disallowed intent(s)
      return false
    default:
      return true
  }
}

/**
 * Connection error for exponential backoff failures
 */
export class ConnectionRetryExhaustedError extends Schema.TaggedError<ConnectionRetryExhaustedError>()(
  'ConnectionRetryExhaustedError',
  {
    message: Schema.String,
    attempts: Schema.Number,
    lastError: Schema.Unknown,
  },
) {}
