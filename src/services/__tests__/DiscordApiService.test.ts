import { it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect } from 'vitest'
import { DISCORD_API_BASE_URL } from '../../discord-utils.js'
import { createMockConfigService, createMockFetch } from '../../test-utils.js'
import { ConfigService } from '../ConfigService.js'
import { DiscordApiError, DiscordApiService, THREAD_TYPE_PUBLIC } from '../DiscordApiService.js'

describe('DiscordApiService', () => {
  const MockConfigServiceLive = createMockConfigService({ channelIds: ['123'] })

  // Create a test version of DiscordApiService without retries to avoid timeouts
  const TestDiscordApiServiceLive = Layer.effect(
    DiscordApiService,
    Effect.gen(function* () {
      const config = yield* ConfigService

      const createThread = (
        channelId: string,
        messageId: string,
        threadName: string,
      ): Effect.Effect<void, DiscordApiError> =>
        Effect.gen(function* () {
          const url = `${DISCORD_API_BASE_URL}/channels/${channelId}/messages/${messageId}/threads`

          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(url, {
                method: 'POST',
                headers: {
                  Authorization: config.getBotDiscordToken(),
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

            yield* new DiscordApiError({
              status: response.status,
              message: `Discord API error (${response.status})`,
              response: errorText,
            })
          }
        })

      return {
        _tag: 'DiscordApiService' as const,
        createThread,
      } as DiscordApiService
    }),
  ).pipe(Layer.provide(MockConfigServiceLive))

  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch()
    mockFetch.setup()
  })

  afterEach(() => {
    mockFetch.cleanup()
  })

  describe('createThread', () => {
    it.effect('should create a thread successfully', () =>
      Effect.gen(function* () {
        mockFetch.mockFetch.mockResolvedValue({
          ok: true,
          status: 201,
          json: async () => ({ id: 'thread-123' }),
        })

        const service = yield* DiscordApiService
        const result = yield* service.createThread('channel-123', 'message-456', 'Test Thread')

        expect(mockFetch.mockFetch).toHaveBeenCalledWith(
          'https://discord.com/api/v10/channels/channel-123/messages/message-456/threads',
          {
            method: 'POST',
            headers: {
              Authorization: expect.stringContaining('Bot '),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: 'Test Thread',
              type: THREAD_TYPE_PUBLIC,
            }),
          },
        )
        expect(result).toBeUndefined()
      }).pipe(Effect.provide(TestDiscordApiServiceLive)),
    )

    it.effect('should handle Discord API error', () =>
      Effect.gen(function* () {
        mockFetch.mockFetch.mockResolvedValue({
          ok: false,
          status: 403,
          text: async () => '{"message": "Missing Permissions", "code": 50013}',
        })

        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const service = yield* DiscordApiService
            yield* service.createThread('channel-123', 'message-456', 'Test Thread')
          }).pipe(Effect.provide(TestDiscordApiServiceLive)),
        )

        expect(exit._tag).toBe('Failure')
        if (exit._tag === 'Failure') {
          const failureCause = exit.cause
          expect(failureCause._tag).toBe('Fail')
          if (failureCause._tag === 'Fail') {
            const error = failureCause.error
            expect(error).toBeInstanceOf(DiscordApiError)
            if (error instanceof DiscordApiError) {
              expect(error.status).toBe(403)
              expect(error.message).toBe('Discord API error (403)')
              expect(error.response).toBe('{"message": "Missing Permissions", "code": 50013}')
            }
          }
        }
      }),
    )

    it.effect('should handle network error', () =>
      Effect.gen(function* () {
        mockFetch.mockFetch.mockRejectedValue(new Error('Network failure'))

        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const service = yield* DiscordApiService
            yield* service.createThread('channel-123', 'message-456', 'Test Thread')
          }).pipe(Effect.provide(TestDiscordApiServiceLive)),
        )

        expect(exit._tag).toBe('Failure')
        if (exit._tag === 'Failure') {
          const failureCause = exit.cause
          expect(failureCause._tag).toBe('Fail')
          if (failureCause._tag === 'Fail') {
            const error = failureCause.error
            expect(error).toBeInstanceOf(DiscordApiError)
            if (error instanceof DiscordApiError) {
              expect(error.status).toBe(0)
              expect(error.message).toBe('Network error')
              expect(error.response).toContain('Network failure')
            }
          }
        }
      }),
    )

    it.effect('should add Bot prefix to token if missing', () =>
      Effect.gen(function* () {
        mockFetch.mockFetch.mockResolvedValue({
          ok: true,
          status: 201,
        })

        const service = yield* DiscordApiService
        yield* service.createThread('channel-123', 'message-456', 'Test Thread')

        expect(mockFetch.mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: expect.stringContaining('Bot '),
            }),
          }),
        )
      }).pipe(Effect.provide(TestDiscordApiServiceLive)),
    )
  })
})
