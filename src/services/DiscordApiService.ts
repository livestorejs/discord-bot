import { Effect, Schema } from 'effect'
import { DISCORD_API_BASE_URL, getBotDiscordToken } from '../discord-utils.js'
import { ConfigService } from './ConfigService.js'
import { ErrorRecovery } from './ErrorRecovery.js'

/**
 * Error that occurs when Discord API request fails
 */
export class DiscordApiError extends Schema.TaggedError<DiscordApiError>()('DiscordApiError', {
  status: Schema.Number,
  message: Schema.String,
  response: Schema.String,
}) {}

/**
 * Error that occurs when Discord API rate limits are exceeded
 */
export class DiscordRateLimitError extends Schema.TaggedError<DiscordRateLimitError>()('DiscordRateLimitError', {
  retryAfter: Schema.Number,
  message: Schema.String,
  endpoint: Schema.String,
}) {}

/**
 * Error that occurs when Discord API authentication fails
 */
export class DiscordAuthenticationError extends Schema.TaggedError<DiscordAuthenticationError>()(
  'DiscordAuthenticationError',
  {
    message: Schema.String,
    status: Schema.Number,
  },
) {}

/**
 * Thread type for Discord public threads
 */
export const THREAD_TYPE_PUBLIC = 11

/**
 * Discord API service for making REST API calls
 */
export class DiscordApiService extends Effect.Service<DiscordApiService>()('DiscordApiService', {
  effect: Effect.gen(function* () {
    const config = yield* ConfigService

    const createThread = (
      channelId: string,
      messageId: string,
      threadName: string,
    ): Effect.Effect<void, DiscordApiError | DiscordRateLimitError | DiscordAuthenticationError> =>
      Effect.gen(function* () {
        const url = `${DISCORD_API_BASE_URL}/channels/${channelId}/messages/${messageId}/threads`

        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              method: 'POST',
              headers: {
                Authorization: getBotDiscordToken(config.config.discordToken),
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                name: threadName,
                type: THREAD_TYPE_PUBLIC,
              }),
            }),
          catch: (error) =>
            new DiscordApiError({
              status: 0,
              message: 'Network error',
              response: String(error),
            }),
        })

        if (!response.ok) {
          const errorText = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: (error) =>
              new DiscordApiError({
                status: response.status,
                message: `Failed to read error response`,
                response: String(error),
              }),
          })

          // Handle specific error cases
          if (response.status === 429) {
            const retryAfter = Number(response.headers.get('retry-after')) || 1
            yield* new DiscordRateLimitError({
              retryAfter,
              message: 'Discord API rate limit exceeded',
              endpoint: url,
            })
          }

          if (response.status === 401 || response.status === 403) {
            yield* new DiscordAuthenticationError({
              message: 'Discord API authentication failed',
              status: response.status,
            })
          }

          yield* new DiscordApiError({
            status: response.status,
            message: `Discord API error (${response.status})`,
            response: errorText,
          })
        }
      }).pipe(
        // Add retry logic for network and rate limit errors
        ErrorRecovery.withNetworkRetry,
        Effect.withSpan('discord-api-create-thread'),
      )

    return { createThread } as const
  }),
  dependencies: [ConfigService.Default],
}) {}
