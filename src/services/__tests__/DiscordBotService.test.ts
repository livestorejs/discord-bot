import { Effect, Exit, Layer, Queue, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { DiscordBotService, DiscordBotStartupError } from '../DiscordBotService.js'
import {
  type DiscordEvent,
  DiscordGatewayError,
  DiscordGatewayService,
  type DiscordMessage,
  DiscordMessageEvent,
} from '../DiscordGatewayService.js'
import { MessageHandlerService, MessageProcessingError } from '../MessageHandlerService.js'
import { createMockMessageHandler } from './test-helpers.js'

describe('DiscordBotService', () => {
  const mockMessage: DiscordMessage = {
    id: 'msg-123',
    channel_id: 'channel-123',
    author: {
      id: 'user-123',
      username: 'testuser',
      discriminator: '0001',
      avatar: null,
      bot: false,
      global_name: 'testuser',
    },
    content: 'Test message for integration',
    timestamp: '2024-01-01T00:00:00.000Z',
    edited_timestamp: null,
    tts: false,
    mention_everyone: false,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    pinned: false,
    type: 0,
  }

  describe('start', () => {
    it('should start the bot and process messages', async () => {
      const processedMessages: DiscordMessage[] = []

      // Mock MessageHandlerService
      const MockMessageHandlerServiceLive = createMockMessageHandler((message) =>
        Effect.gen(function* () {
          processedMessages.push(message)
          yield* Effect.log(`Test: Message ${message.id} processed`)
        }),
      )

      // Create simple gateway mock
      const messageEvent = new DiscordMessageEvent({ message: mockMessage })
      const MockDiscordGatewayServiceLive = Layer.effect(
        DiscordGatewayService,
        Effect.gen(function* () {
          const eventQueue = yield* Queue.unbounded<DiscordEvent>()

          return {
            _tag: 'DiscordGatewayService',
            connect: () =>
              Effect.gen(function* () {
                // Emit message immediately
                yield* Queue.offer(eventQueue, messageEvent)

                return {
                  events: Stream.fromQueue(eventQueue),
                  disconnect: () => Effect.succeed(undefined),
                }
              }),
          } as unknown as DiscordGatewayService
        }),
      )

      const TestLayer = DiscordBotService.Default.pipe(
        Layer.provide(MockMessageHandlerServiceLive),
        Layer.provide(MockDiscordGatewayServiceLive),
      )

      const program = Effect.gen(function* () {
        const botService = yield* DiscordBotService
        const { shutdown } = yield* botService.start()

        // Give time for message processing
        yield* Effect.sleep('1 second')

        // Shutdown
        yield* shutdown()

        // Verify message was processed
        expect(processedMessages).toHaveLength(1)
        expect(processedMessages[0].id).toBe('msg-123')
      })

      await Effect.runPromise(Effect.provide(program, TestLayer))
    })

    it('should handle message processing errors gracefully', async () => {
      // Mock MessageHandlerService that throws errors
      const MockMessageHandlerServiceLive = createMockMessageHandler((message: DiscordMessage) =>
        Effect.fail(
          new MessageProcessingError({
            messageId: message.id,
            channelId: message.channel_id,
            reason: 'Test error',
            cause: new Error('Simulated error'),
          }),
        ),
      )

      // Create gateway with multiple events
      const events = [
        new DiscordMessageEvent({ message: mockMessage }),
        new DiscordMessageEvent({
          message: { ...mockMessage, id: 'msg-124' },
        }),
      ]
      const MockDiscordGatewayServiceLive = Layer.effect(
        DiscordGatewayService,
        Effect.gen(function* () {
          const eventQueue = yield* Queue.unbounded<DiscordEvent>()

          return {
            _tag: 'DiscordGatewayService',
            connect: () =>
              Effect.gen(function* () {
                yield* Effect.forkDaemon(
                  Effect.gen(function* () {
                    for (const event of events) {
                      yield* Effect.sleep('10 millis')
                      yield* Queue.offer(eventQueue, event)
                    }
                  }),
                )

                return {
                  events: Stream.fromQueue(eventQueue),
                  disconnect: () => Effect.succeed(undefined),
                }
              }),
          } as unknown as DiscordGatewayService
        }),
      )

      const TestLayer = DiscordBotService.Default.pipe(
        Layer.provide(MockMessageHandlerServiceLive),
        Layer.provide(MockDiscordGatewayServiceLive),
      )

      const program = Effect.gen(function* () {
        const botService = yield* DiscordBotService
        const { shutdown } = yield* botService.start()

        // Give time for processing
        yield* Effect.sleep('100 millis')

        // Shutdown
        yield* shutdown()

        // Bot should continue running despite errors
        // (errors are caught and logged but don't crash the bot)
      })

      // Should not throw
      await Effect.runPromise(Effect.provide(program, TestLayer))
    })

    it('should handle gateway connection errors', async () => {
      // Mock DiscordGatewayService that fails to connect
      const MockDiscordGatewayServiceLive = Layer.succeed(DiscordGatewayService, {
        _tag: 'DiscordGatewayService',
        connect: () =>
          Effect.fail(
            new DiscordGatewayError({
              message: 'Failed to connect to Discord Gateway',
              cause: new Error('Test connection failure'),
            }),
          ),
      } as unknown as DiscordGatewayService)

      const TestLayer = DiscordBotService.Default.pipe(
        Layer.provide(
          Layer.succeed(MessageHandlerService, {
            _tag: 'MessageHandlerService',
            handleMessage: () => Effect.succeed(undefined),
          } as MessageHandlerService),
        ),
        Layer.provide(MockDiscordGatewayServiceLive),
      )

      const program = Effect.gen(function* () {
        const botService = yield* DiscordBotService
        yield* botService.start()
      })

      const result = await Effect.runPromiseExit(Effect.provide(program, TestLayer))

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const failureCause = result.cause
        expect(failureCause._tag).toBe('Fail')
        if (failureCause._tag === 'Fail') {
          const error = failureCause.error
          expect(error).toBeInstanceOf(DiscordBotStartupError)
          expect(error.message).toContain('Failed to connect to Discord Gateway')
        }
      }
    })

    it('should shutdown gracefully', async () => {
      let disconnectCalled = false

      // Mock DiscordGatewayService
      const MockDiscordGatewayServiceLive = Layer.succeed(DiscordGatewayService, {
        _tag: 'DiscordGatewayService',
        connect: () =>
          Effect.succeed({
            events: Stream.never,
            disconnect: () => {
              disconnectCalled = true
              return Effect.succeed(undefined)
            },
          }),
      } as unknown as DiscordGatewayService)

      const TestLayer = DiscordBotService.Default.pipe(
        Layer.provide(
          Layer.succeed(MessageHandlerService, {
            _tag: 'MessageHandlerService',
            handleMessage: () => Effect.succeed(undefined),
          } as MessageHandlerService),
        ),
        Layer.provide(MockDiscordGatewayServiceLive),
      )

      const program = Effect.gen(function* () {
        const botService = yield* DiscordBotService
        const { shutdown } = yield* botService.start()

        // Give time to start
        yield* Effect.sleep('50 millis')

        // Shutdown
        yield* shutdown()

        // Verify disconnect was called
        expect(disconnectCalled).toBe(true)
      })

      await Effect.runPromise(Effect.provide(program, TestLayer))
    })
  })
})
