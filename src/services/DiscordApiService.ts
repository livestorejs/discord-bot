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
        Effect.withSpan('discord-api-create-thread', {
          attributes: {
            'span.label': `Create thread: "${threadName}"`,
            'discord.channel.id': channelId,
            'discord.message.id': messageId,
            'thread.name': threadName,
            'thread.type': THREAD_TYPE_PUBLIC,
          },
        }),
      )

    const acknowledgeInteraction = (
      interactionId: string,
      interactionToken: string,
      type: number = 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    ): Effect.Effect<void, DiscordApiError | DiscordRateLimitError | DiscordAuthenticationError> =>
      Effect.gen(function* () {
        const url = `${DISCORD_API_BASE_URL}/interactions/${interactionId}/${interactionToken}/callback`

        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                type,
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
          yield* handleApiError(response, url)
        }
      }).pipe(
        Effect.withSpan('discord-api-acknowledge-interaction', {
          attributes: {
            'span.label': 'Acknowledge interaction',
            'discord.interaction.id': interactionId,
            'discord.interaction.response_type': type,
          },
        }),
      )

    const editInteractionResponse = (
      applicationId: string,
      interactionToken: string,
      content: string | { content?: string; embeds?: any[] },
    ): Effect.Effect<void, DiscordApiError | DiscordRateLimitError | DiscordAuthenticationError> =>
      Effect.gen(function* () {
        const url = `${DISCORD_API_BASE_URL}/webhooks/${applicationId}/${interactionToken}/messages/@original`

        const body = typeof content === 'string' ? { content } : content

        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
            }),
          catch: (error) =>
            new DiscordApiError({
              status: 0,
              message: 'Network error',
              response: String(error),
            }),
        })

        if (!response.ok) {
          yield* handleApiError(response, url)
        }
      }).pipe(
        ErrorRecovery.withNetworkRetry,
        Effect.withSpan('discord-api-edit-interaction-response', {
          attributes: {
            'span.label': 'Edit interaction response',
            'discord.application.id': applicationId,
            'discord.content.length': typeof content === 'string' ? content.length : JSON.stringify(content).length,
          },
        }),
      )

    const createGlobalCommand = (
      applicationId: string,
      command: {
        name: string
        description: string
        options?: Array<{
          type: number
          name: string
          description: string
          required?: boolean
        }>
      },
    ): Effect.Effect<void, DiscordApiError | DiscordRateLimitError | DiscordAuthenticationError> =>
      Effect.gen(function* () {
        const url = `${DISCORD_API_BASE_URL}/applications/${applicationId}/commands`

        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              method: 'POST',
              headers: {
                Authorization: getBotDiscordToken(config.config.discordToken),
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(command),
            }),
          catch: (error) =>
            new DiscordApiError({
              status: 0,
              message: 'Network error',
              response: String(error),
            }),
        })

        if (!response.ok) {
          yield* handleApiError(response, url)
        }
      }).pipe(
        ErrorRecovery.withNetworkRetry,
        Effect.withSpan('discord-api-create-global-command', {
          attributes: {
            'span.label': `Create command: /${command.name}`,
            'discord.application.id': applicationId,
            'discord.command.name': command.name,
            'discord.command.description': command.description,
          },
        }),
      )

    // Helper to handle API errors consistently
    const handleApiError = (response: Response, url: string) =>
      Effect.gen(function* () {
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
      })

    return { createThread, acknowledgeInteraction, editInteractionResponse, createGlobalCommand } as const
  }),
  dependencies: [ConfigService.Default],
}) {}
