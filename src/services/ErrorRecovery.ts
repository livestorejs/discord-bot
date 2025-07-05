import { Effect, Ref, Schedule, Schema } from 'effect'

/**
 * Circuit breaker error
 */
export class CircuitBreakerOpenError extends Schema.TaggedError<CircuitBreakerOpenError>()('CircuitBreakerOpenError', {
  cooldownRemaining: Schema.Number,
}) {}

/**
 * Parse duration string to milliseconds
 */
const parseDuration = (duration: string): number => {
  const match = duration.match(/^(\d+)\s*(milliseconds?|millis?|seconds?|minutes?|hours?)$/i)
  if (!match) throw new Error(`Invalid duration format: ${duration}`)

  const value = parseInt(match[1])
  const unit = match[2].toLowerCase()

  switch (unit) {
    case 'millisecond':
    case 'milliseconds':
    case 'milli':
    case 'millis':
      return value
    case 'second':
    case 'seconds':
      return value * 1000
    case 'minute':
    case 'minutes':
      return value * 60 * 1000
    case 'hour':
    case 'hours':
      return value * 60 * 60 * 1000
    default:
      throw new Error(`Unknown time unit: ${unit}`)
  }
}

/**
 * Retry policies for different types of operations
 */
export const RetryPolicies = {
  /**
   * Exponential backoff for network operations
   * Retries up to 3 times with exponential delay
   */
  network: Schedule.exponential('100 millis').pipe(
    Schedule.compose(Schedule.recurs(3)),
    Schedule.jittered, // Add jitter to prevent thundering herd
  ),

  /**
   * Rate limit backoff with respect for retry-after headers
   * More aggressive retry for rate limits
   */
  rateLimit: (retryAfterSeconds: number) =>
    Schedule.exponential(`${retryAfterSeconds * 1000} millis`).pipe(Schedule.compose(Schedule.recurs(5))),

  /**
   * Quick retry for transient failures
   * 2 retries with short delay
   */
  transient: Schedule.exponential('50 millis').pipe(Schedule.compose(Schedule.recurs(2))),

  /**
   * Authentication retry (fewer attempts)
   * Only retry once after a short delay
   */
  authentication: Schedule.exponential('1 second').pipe(Schedule.compose(Schedule.recurs(1))),
} as const

/**
 * Error recovery strategies for common failure patterns
 */
export const ErrorRecovery = {
  /**
   * Retry an effect with exponential backoff for network errors
   */
  withNetworkRetry: <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(Effect.retry(RetryPolicies.network), Effect.withSpan('error-recovery-network')),

  /**
   * Retry an effect with rate limit awareness
   */
  withRateLimitRetry: <A, E>(effect: Effect.Effect<A, E>, retryAfterSeconds: number = 1) =>
    effect.pipe(Effect.retry(RetryPolicies.rateLimit(retryAfterSeconds)), Effect.withSpan('error-recovery-rate-limit')),

  /**
   * Circuit breaker pattern for failing services using Effect patterns
   */
  withCircuitBreaker: <A, E>(
    effect: Effect.Effect<A, E>,
    failureThreshold: number = 3,
    cooldownPeriod: string = '30 seconds',
  ) =>
    Effect.gen(function* () {
      // Circuit breaker state
      const circuitState = yield* Ref.make<{
        consecutiveFailures: number
        lastFailureTime: number
        isOpen: boolean
      }>({
        consecutiveFailures: 0,
        lastFailureTime: 0,
        isOpen: false,
      })

      return Effect.gen(function* () {
        const state = yield* Ref.get(circuitState)
        const now = Date.now()

        // Check if circuit is open
        if (state.isOpen) {
          const cooldownMs = parseDuration(cooldownPeriod)
          if (now - state.lastFailureTime < cooldownMs) {
            yield* Effect.fail(
              new CircuitBreakerOpenError({ cooldownRemaining: cooldownMs - (now - state.lastFailureTime) }),
            )
          } else {
            // Half-open state: allow one request through
            yield* Ref.update(circuitState, (s) => ({ ...s, isOpen: false }))
          }
        }

        // Execute the effect
        return yield* effect.pipe(
          Effect.tap(() =>
            // Reset on success
            Ref.set(circuitState, {
              consecutiveFailures: 0,
              lastFailureTime: 0,
              isOpen: false,
            }),
          ),
          Effect.catchAll((error) =>
            Ref.modify(circuitState, (state) => {
              const newFailures = state.consecutiveFailures + 1
              const shouldOpen = newFailures >= failureThreshold
              const newState = {
                consecutiveFailures: newFailures,
                lastFailureTime: now,
                isOpen: shouldOpen,
              }
              return [Effect.fail(error), newState]
            }).pipe(Effect.flatten),
          ),
        )
      }).pipe(Effect.withSpan('error-recovery-circuit-breaker'))
    }).pipe(Effect.flatten),

  /**
   * Fallback strategy - try primary effect, fall back to secondary on failure
   */
  withFallback: <A, E1, E2>(primary: Effect.Effect<A, E1>, fallback: Effect.Effect<A, E2>) =>
    primary.pipe(
      Effect.catchAll(() => fallback),
      Effect.withSpan('error-recovery-fallback'),
    ),

  /**
   * Timeout with graceful degradation
   */
  withTimeout: <A, E>(effect: Effect.Effect<A, E>, duration: string, fallback?: Effect.Effect<A, E>) => {
    const timedEffect = effect.pipe(Effect.timeout(duration as any))

    if (fallback) {
      return timedEffect.pipe(
        Effect.catchAll(() => fallback),
        Effect.withSpan('error-recovery-timeout-fallback'),
      )
    }

    return timedEffect.pipe(Effect.withSpan('error-recovery-timeout'))
  },
} as const
