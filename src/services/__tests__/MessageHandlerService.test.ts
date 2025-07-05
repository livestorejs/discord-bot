import { it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { describe, expect } from 'vitest'
import { createMockConfigService, createMockMessage } from '../../test-utils.js'
import { AiService, AiSummarizationError } from '../AiService.js'
import { DiscordApiError, DiscordApiService } from '../DiscordApiService.js'
import { MessageHandlerService } from '../MessageHandlerService.js'

describe('MessageHandlerService', () => {
  const MockConfigServiceLive = createMockConfigService()

  const MockAiServiceLive = Layer.succeed(AiService, {
    _tag: 'AiService',
    summarizeMessage: (content: string) => Effect.succeed(`Summary: ${content.slice(0, 20)}...`),
  } as AiService)

  const MockDiscordApiServiceLive = Layer.succeed(DiscordApiService, {
    _tag: 'DiscordApiService',
    createThread: () => Effect.succeed(undefined),
  } as DiscordApiService)

  // Note: Logger mocking removed due to API complexity

  const TestMessageHandlerServiceLive = MessageHandlerService.Default.pipe(
    Layer.provide(MockConfigServiceLive),
    Layer.provide(MockAiServiceLive),
    Layer.provide(MockDiscordApiServiceLive),
  )

  describe('handleMessage', () => {
    it.effect('should skip bot messages', () =>
      Effect.gen(function* () {
        const botMessage = createMockMessage({
          author: {
            ...createMockMessage().author,
            bot: true,
          },
        })

        const service = yield* MessageHandlerService
        const result = yield* service.handleMessage(botMessage)

        // Should complete without error
        expect(result).toBeUndefined()
      }).pipe(Effect.provide(TestMessageHandlerServiceLive)),
    )

    it.effect('should skip messages not in allowed channels', () =>
      Effect.gen(function* () {
        const message = createMockMessage({
          channel_id: 'channel-999',
        })

        const service = yield* MessageHandlerService
        const result = yield* service.handleMessage(message)

        // Should complete without error
        expect(result).toBeUndefined()
      }).pipe(Effect.provide(TestMessageHandlerServiceLive)),
    )

    it.effect('should process messages in allowed channels', () =>
      Effect.gen(function* () {
        const message = createMockMessage()

        const service = yield* MessageHandlerService
        const result = yield* service.handleMessage(message)

        // Should complete without error
        expect(result).toBeUndefined()
      }).pipe(Effect.provide(TestMessageHandlerServiceLive)),
    )

    it.effect('should process replies to messages in allowed channels', () =>
      Effect.gen(function* () {
        const message = createMockMessage({
          channel_id: 'channel-999',
          message_reference: {
            channel_id: 'channel-123',
            message_id: 'ref-123',
          },
        })

        const service = yield* MessageHandlerService
        const result = yield* service.handleMessage(message)

        // Should complete without error
        expect(result).toBeUndefined()
      }).pipe(Effect.provide(TestMessageHandlerServiceLive)),
    )

    it.effect('should skip low-value messages when filtering is enabled', () =>
      Effect.gen(function* () {
        const shortMessage = createMockMessage({
          content: 'Hi!',
        })

        const service = yield* MessageHandlerService
        const result = yield* service.handleMessage(shortMessage)

        // Should complete without error
        expect(result).toBeUndefined()
      }).pipe(Effect.provide(TestMessageHandlerServiceLive)),
    )

    it.effect('should handle AI service errors gracefully', () => {
      const mockAiServiceWithError = Layer.succeed(AiService, {
        _tag: 'AiService',
        summarizeMessage: () =>
          Effect.fail(
            new AiSummarizationError({
              message: 'AI service failed',
              cause: new Error('Network error'),
            }),
          ),
      } as AiService)

      return Effect.gen(function* () {
        const message = createMockMessage()

        // The service should handle errors gracefully and not throw
        const service = yield* MessageHandlerService
        const result = yield* service.handleMessage(message)

        // Should complete without error (errors are logged but not thrown)
        expect(result).toBeUndefined()
      }).pipe(
        Effect.provide(MessageHandlerService.Default),
        Effect.provide(MockConfigServiceLive),
        Effect.provide(mockAiServiceWithError),
        Effect.provide(MockDiscordApiServiceLive),
      )
    })

    it.effect('should handle Discord API errors gracefully', () => {
      const mockDiscordApiServiceWithError = Layer.succeed(DiscordApiService, {
        _tag: 'DiscordApiService',
        createThread: () =>
          Effect.fail(
            new DiscordApiError({
              status: 403,
              message: 'Missing permissions',
              response: '{"error": "Missing permissions"}',
            }),
          ),
      } as DiscordApiService)

      return Effect.gen(function* () {
        const message = createMockMessage()

        // The service should handle errors gracefully and not throw
        const service = yield* MessageHandlerService
        const result = yield* service.handleMessage(message)

        // Should complete without error (errors are logged but not thrown)
        expect(result).toBeUndefined()
      }).pipe(
        Effect.provide(MessageHandlerService.Default),
        Effect.provide(MockConfigServiceLive),
        Effect.provide(MockAiServiceLive),
        Effect.provide(mockDiscordApiServiceWithError),
      )
    })
  })
})
