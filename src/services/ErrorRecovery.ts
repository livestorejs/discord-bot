import { Effect, Schedule } from 'effect'

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
   * Circuit breaker pattern for failing services
   */
  withCircuitBreaker: <A, E>(effect: Effect.Effect<A, E>, failureThreshold: number = 3) => {
    // Simple circuit breaker implementation
    // In production, consider using a more sophisticated circuit breaker
    let consecutiveFailures = 0
    let lastFailureTime = 0
    const cooldownPeriod = 30000 // 30 seconds

    return Effect.gen(function* () {
      const now = Date.now()

      // Check if circuit is open
      if (consecutiveFailures >= failureThreshold) {
        if (now - lastFailureTime < cooldownPeriod) {
          yield* Effect.fail('Circuit breaker is open' as any)
        } else {
          // Reset circuit breaker after cooldown
          consecutiveFailures = 0
        }
      }

      try {
        const result = yield* effect
        consecutiveFailures = 0 // Reset on success
        return result
      } catch (error) {
        consecutiveFailures++
        lastFailureTime = now
        throw error
      }
    }).pipe(Effect.withSpan('error-recovery-circuit-breaker'))
  },

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
