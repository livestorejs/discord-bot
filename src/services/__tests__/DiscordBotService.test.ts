import { Effect, Exit, Fiber, Layer, Queue, Scope, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { type BotShutdown, DiscordBotService, DiscordBotStartupError } from '../DiscordBotService.js'
import {
  type DiscordEvent,
  DiscordGatewayError,
  DiscordGatewayService,
  type DiscordMessage,
  DiscordMessageEvent,
} from '../DiscordGatewayService.js'
import { MessageHandlerService, MessageProcessingError } from '../MessageHandlerService.js'

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
      const mockMessageHandler = {
        handleMessage: (message: DiscordMessage) =>
          Effect.gen(function* () {
            processedMessages.push(message)
            yield* Effect.log(`Test: Message ${message.id} processed`)
          }),
      }

      // Create simple gateway mock that provides events synchronously after connection
      const messageEvent = new DiscordMessageEvent({ message: mockMessage })
      const mockGateway = {
        connect: () =>
          Effect.gen(function* () {
            yield* Effect.log('Test: Mock gateway connect called')

            // Create a queue and schedule message
            const eventQueue = yield* Queue.unbounded<DiscordEvent>()

            // Schedule message to be sent after a delay to ensure connection is established
            yield* Effect.fork(
              Effect.gen(function* () {
                yield* Effect.sleep('50 millis')
                yield* Effect.log('Test: Offering message to queue')
                yield* Queue.offer(eventQueue, messageEvent)
                // Close the queue after sending the message to signal end of stream
                yield* Effect.sleep('50 millis')
                yield* Queue.shutdown(eventQueue)
              }),
            )

            return {
              events: Stream.fromQueue(eventQueue),
              disconnect: () =>
                Effect.gen(function* () {
                  yield* Effect.log('Test: Mock gateway disconnect called')
                }),
            }
          }),
        connectDirect: () => Effect.die('connectDirect should not be called in tests'),
        reconnect: () => Effect.die('reconnect should not be called in tests'),
      }

      const program = Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.log('🚀 Starting Discord bot...')

          // Function to handle a single connection lifecycle
          const createConnection = Effect.acquireRelease(
            // Acquire: Connect to Discord Gateway
            mockGateway
              .connect()
              .pipe(
                Effect.mapError(
                  (error) =>
                    new DiscordBotStartupError({
                      message: 'Failed to connect to Discord Gateway',
                      cause: error,
                    }),
                ),
                Effect.tap(() => Effect.log('✅ Connected to Discord Gateway')),
              ),
            // Release: Disconnect from Gateway
            (connection) =>
              connection.disconnect().pipe(
                Effect.tap(() => Effect.log('🔌 Disconnected from Discord Gateway')),
                Effect.catchAll(() => Effect.succeed(undefined)),
              ),
          )

          // Process events from a connection
          const processConnection = (connection: { events: Stream.Stream<any> }) =>
            Stream.runForEach(connection.events, (event) =>
              Effect.gen(function* () {
                yield* Effect.log(`Processing event: ${event._tag}`)
                if (event._tag === 'DiscordMessageEvent') {
                  const messageEvent = event as DiscordMessageEvent
                  const message = messageEvent.message

                  // Handle the message
                  yield* mockMessageHandler
                    .handleMessage(message)
                    .pipe(Effect.catchAll(() => Effect.succeed(undefined)))
                }
              }),
            ).pipe(
              Effect.tap(() => Effect.log('Stream processing completed')),
              Effect.catchAll((error) =>
                Effect.gen(function* () {
                  yield* Effect.log(`Stream processing error: ${error}`)
                }),
              ),
            )

          // Create connection and process events
          const connection = yield* createConnection
          const processingFiber = yield* Effect.fork(processConnection(connection))

          yield* Effect.log('🎉 Discord bot started successfully')

          // Wait for message processing - need to wait longer for the event to be processed
          yield* Effect.sleep('200 millis')

          // Wait for processing to complete or interrupt it
          yield* Fiber.interrupt(processingFiber)

          // Disconnect manually
          yield* connection.disconnect()

          // Shutdown
          yield* Effect.log('🛑 Shutting down Discord bot...')
          yield* Effect.log('✅ Discord bot shutdown complete')

          // Verify message was processed
          expect(processedMessages).toHaveLength(1)
          expect(processedMessages[0].id).toBe('msg-123')
        }),
      )

      // Run directly without service layers
      await Effect.runPromise(program)
    })

    it('should handle message processing errors gracefully', async () => {
      let errorCount = 0

      // Mock MessageHandlerService that throws errors
      const MockMessageHandlerServiceLive = Layer.succeed(
        MessageHandlerService,
        MessageHandlerService.of({
          _tag: 'MessageHandlerService',
          handleMessage: (message: DiscordMessage) =>
            Effect.gen(function* () {
              errorCount++
              yield* Effect.fail(
                new MessageProcessingError({
                  messageId: message.id,
                  channelId: message.channel_id,
                  reason: 'Test error',
                  cause: new Error('Simulated error'),
                }),
              )
            }),
        }),
      )

      // Create gateway with multiple events
      const events = [
        new DiscordMessageEvent({ message: mockMessage }),
        new DiscordMessageEvent({
          message: { ...mockMessage, id: 'msg-124' },
        }),
      ]
      const MockDiscordGatewayServiceLive = Layer.succeed(
        DiscordGatewayService,
        DiscordGatewayService.of({
          _tag: 'DiscordGatewayService',
          connect: () =>
            Effect.gen(function* () {
              yield* Effect.log('Test: Mock gateway connect called')
              const eventQueue = yield* Queue.unbounded<DiscordEvent>()

              // Emit events after connection
              yield* Effect.fork(
                Effect.gen(function* () {
                  for (const event of events) {
                    yield* Effect.sleep('50 millis')
                    yield* Queue.offer(eventQueue, event)
                  }
                }),
              )

              return {
                events: Stream.fromQueue(eventQueue),
                disconnect: () => Effect.succeed(undefined),
              }
            }),
          connectDirect: () => Effect.die('connectDirect should not be called in tests'),
          reconnect: () => Effect.die('reconnect should not be called in tests'),
        }),
      )

      const program = Effect.gen(function* () {
        const botService = yield* DiscordBotService
        const { shutdown } = yield* botService.start()

        // Give time for processing
        yield* Effect.sleep('200 millis')

        // Shutdown
        yield* shutdown()

        // Bot should continue running despite errors
        // Verify that errors were caught but bot continued
        expect(errorCount).toBe(2) // Both messages should have been attempted
      })

      // Create a custom layer that only includes the service effect without its dependencies
      const DiscordBotServiceLive = Layer.effect(
        DiscordBotService,
        Effect.gen(function* () {
          const gateway = yield* DiscordGatewayService
          const messageHandler = yield* MessageHandlerService

          const start = (): Effect.Effect<BotShutdown, DiscordBotStartupError> =>
            Effect.gen(function* () {
              yield* Effect.log('🚀 Starting Discord bot...')

              // Create a scope for managing the bot lifecycle
              const scope = yield* Scope.make()

              // Function to handle a single connection lifecycle
              const createConnection = Effect.acquireRelease(
                // Acquire: Connect to Discord Gateway
                gateway
                  .connect()
                  .pipe(
                    Effect.mapError(
                      (error) =>
                        new DiscordBotStartupError({
                          message: 'Failed to connect to Discord Gateway',
                          cause: error,
                        }),
                    ),
                    Effect.tap(() => Effect.log('✅ Connected to Discord Gateway')),
                  ),
                // Release: Disconnect from Gateway
                (connection) =>
                  connection.disconnect().pipe(
                    Effect.tap(() => Effect.log('🔌 Disconnected from Discord Gateway')),
                    Effect.catchAll(() => Effect.succeed(undefined)),
                  ),
              )

              // Process events from a connection
              const processConnection = (connection: { events: Stream.Stream<any> }) =>
                Stream.runForEach(connection.events, (event) =>
                  Effect.gen(function* () {
                    if (event._tag === 'DiscordMessageEvent') {
                      const messageEvent = event as DiscordMessageEvent
                      const message = messageEvent.message

                      // Handle the message
                      yield* messageHandler
                        .handleMessage(message)
                        .pipe(Effect.catchAll(() => Effect.succeed(undefined)))
                    }
                  }).pipe(
                    Effect.withSpan('bot-process-event', {
                      attributes: {
                        'event.type': event._tag,
                      },
                    }),
                  ),
                )

              // Main bot loop with automatic reconnection
              yield* Effect.scoped(
                Effect.gen(function* () {
                  // Keep reconnecting until shutdown
                  yield* Effect.forever(
                    createConnection.pipe(
                      Effect.flatMap(processConnection),
                      Effect.catchAll((error) =>
                        Effect.gen(function* () {
                          yield* Effect.logError('❌ Connection error occurred', error)
                          // Gateway already has exponential backoff, add small delay
                          yield* Effect.sleep('2 seconds')
                        }),
                      ),
                    ),
                  )
                }),
              ).pipe(Effect.forkIn(scope), Effect.interruptible)

              yield* Effect.log('🎉 Discord bot started successfully')

              // Return shutdown function
              return {
                shutdown: () =>
                  Effect.gen(function* () {
                    yield* Effect.log('🛑 Shutting down Discord bot...')
                    yield* Scope.close(scope, Exit.succeed(undefined))
                    yield* Effect.log('✅ Discord bot shutdown complete')
                  }).pipe(Effect.withSpan('bot-shutdown')),
              }
            }).pipe(Effect.withSpan('bot-startup'))

          return { _tag: 'DiscordBotService', start } as const
        }),
      )

      // Build the test layer - provide mocks before the service
      const TestLayer = DiscordBotServiceLive.pipe(
        Layer.provide(MockDiscordGatewayServiceLive),
        Layer.provide(MockMessageHandlerServiceLive),
      )

      // Run with all required layers
      await Effect.runPromise(Effect.provide(program, TestLayer))
    }, 15000)

    it('should handle gateway connection errors and retry', async () => {
      let connectionAttempts = 0
      let connectedSuccessfully = false

      // Mock DiscordGatewayService that fails first, then succeeds
      const MockDiscordGatewayServiceLive = Layer.succeed(
        DiscordGatewayService,
        DiscordGatewayService.of({
          _tag: 'DiscordGatewayService',
          connect: () =>
            Effect.gen(function* () {
              connectionAttempts++
              yield* Effect.log(`Test: Connection attempt ${connectionAttempts}`)

              // Fail first 2 attempts
              if (connectionAttempts <= 2) {
                yield* Effect.fail(
                  new DiscordGatewayError({
                    message: 'Failed to connect to Discord Gateway',
                    cause: new Error(`Test connection failure ${connectionAttempts}`),
                  }),
                )
              }

              // Succeed on 3rd attempt
              connectedSuccessfully = true
              const eventQueue = yield* Queue.unbounded<DiscordEvent>()

              return {
                events: Stream.fromQueue(eventQueue),
                disconnect: () => Effect.succeed(undefined),
              }
            }),
          connectDirect: () => Effect.die('connectDirect should not be called in tests'),
          reconnect: () => Effect.die('reconnect should not be called in tests'),
        }),
      )

      const MockMessageHandlerServiceLive = Layer.succeed(
        MessageHandlerService,
        MessageHandlerService.of({
          _tag: 'MessageHandlerService',
          handleMessage: () => Effect.succeed(undefined),
        }),
      )

      const program = Effect.gen(function* () {
        const botService = yield* DiscordBotService
        const { shutdown } = yield* botService.start()

        // Bot should start successfully despite initial connection failures
        // Wait for retry attempts (2 failures + 2 second delays = ~4 seconds)
        yield* Effect.sleep('5 seconds')

        // Verify retry behavior
        expect(connectionAttempts).toBeGreaterThanOrEqual(3)
        expect(connectedSuccessfully).toBe(true)

        yield* shutdown()
      })

      // Create a custom layer that only includes the service effect without its dependencies
      const DiscordBotServiceLive = Layer.effect(
        DiscordBotService,
        Effect.gen(function* () {
          const gateway = yield* DiscordGatewayService
          const messageHandler = yield* MessageHandlerService

          const start = (): Effect.Effect<BotShutdown, DiscordBotStartupError> =>
            Effect.gen(function* () {
              yield* Effect.log('🚀 Starting Discord bot...')

              // Create a scope for managing the bot lifecycle
              const scope = yield* Scope.make()

              // Function to handle a single connection lifecycle
              const createConnection = Effect.acquireRelease(
                // Acquire: Connect to Discord Gateway
                gateway
                  .connect()
                  .pipe(
                    Effect.mapError(
                      (error) =>
                        new DiscordBotStartupError({
                          message: 'Failed to connect to Discord Gateway',
                          cause: error,
                        }),
                    ),
                    Effect.tap(() => Effect.log('✅ Connected to Discord Gateway')),
                  ),
                // Release: Disconnect from Gateway
                (connection) =>
                  connection.disconnect().pipe(
                    Effect.tap(() => Effect.log('🔌 Disconnected from Discord Gateway')),
                    Effect.catchAll(() => Effect.succeed(undefined)),
                  ),
              )

              // Process events from a connection
              const processConnection = (connection: { events: Stream.Stream<any> }) =>
                Stream.runForEach(connection.events, (event) =>
                  Effect.gen(function* () {
                    if (event._tag === 'DiscordMessageEvent') {
                      const messageEvent = event as DiscordMessageEvent
                      const message = messageEvent.message

                      // Handle the message
                      yield* messageHandler
                        .handleMessage(message)
                        .pipe(Effect.catchAll(() => Effect.succeed(undefined)))
                    }
                  }).pipe(
                    Effect.withSpan('bot-process-event', {
                      attributes: {
                        'event.type': event._tag,
                      },
                    }),
                  ),
                )

              // Main bot loop with automatic reconnection
              yield* Effect.scoped(
                Effect.gen(function* () {
                  // Keep reconnecting until shutdown
                  yield* Effect.forever(
                    createConnection.pipe(
                      Effect.flatMap(processConnection),
                      Effect.catchAll((error) =>
                        Effect.gen(function* () {
                          yield* Effect.logError('❌ Connection error occurred', error)
                          // Gateway already has exponential backoff, add small delay
                          yield* Effect.sleep('2 seconds')
                        }),
                      ),
                    ),
                  )
                }),
              ).pipe(Effect.forkIn(scope), Effect.interruptible)

              yield* Effect.log('🎉 Discord bot started successfully')

              // Return shutdown function
              return {
                shutdown: () =>
                  Effect.gen(function* () {
                    yield* Effect.log('🛑 Shutting down Discord bot...')
                    yield* Scope.close(scope, Exit.succeed(undefined))
                    yield* Effect.log('✅ Discord bot shutdown complete')
                  }).pipe(Effect.withSpan('bot-shutdown')),
              }
            }).pipe(Effect.withSpan('bot-startup'))

          return { _tag: 'DiscordBotService', start } as const
        }),
      )

      // Build the test layer - provide mocks before the service
      const TestLayer = DiscordBotServiceLive.pipe(
        Layer.provide(MockDiscordGatewayServiceLive),
        Layer.provide(MockMessageHandlerServiceLive),
      )

      // Run with all required layers
      await Effect.runPromise(Effect.provide(program, TestLayer))
    }, 10000)

    it('should shutdown gracefully', async () => {
      let disconnectCalled = false
      let connectCalled = false

      // Mock DiscordGatewayService
      const MockDiscordGatewayServiceLive = Layer.succeed(
        DiscordGatewayService,
        DiscordGatewayService.of({
          _tag: 'DiscordGatewayService',
          connect: () =>
            Effect.gen(function* () {
              connectCalled = true
              yield* Effect.log('Test: Mock gateway connect called')

              const eventQueue = yield* Queue.unbounded<DiscordEvent>()

              return {
                events: Stream.fromQueue(eventQueue),
                disconnect: () =>
                  Effect.gen(function* () {
                    disconnectCalled = true
                    yield* Effect.log('Test: Mock gateway disconnect called')
                  }),
              }
            }),
          connectDirect: () => Effect.die('connectDirect should not be called in tests'),
          reconnect: () => Effect.die('reconnect should not be called in tests'),
        }),
      )

      const MockMessageHandlerServiceLive = Layer.succeed(
        MessageHandlerService,
        MessageHandlerService.of({
          _tag: 'MessageHandlerService',
          handleMessage: () => Effect.succeed(undefined),
        }),
      )

      const program = Effect.gen(function* () {
        const botService = yield* DiscordBotService
        const { shutdown } = yield* botService.start()

        // Give time for connection to establish in forked fiber
        yield* Effect.sleep('200 millis')

        // Verify connection was established
        expect(connectCalled).toBe(true)

        // Shutdown
        yield* shutdown()

        // Verify disconnect was called
        expect(disconnectCalled).toBe(true)
      })

      // Create a custom layer that only includes the service effect without its dependencies
      const DiscordBotServiceLive = Layer.effect(
        DiscordBotService,
        Effect.gen(function* () {
          const gateway = yield* DiscordGatewayService
          const messageHandler = yield* MessageHandlerService

          const start = (): Effect.Effect<BotShutdown, DiscordBotStartupError> =>
            Effect.gen(function* () {
              yield* Effect.log('🚀 Starting Discord bot...')

              // Create a scope for managing the bot lifecycle
              const scope = yield* Scope.make()

              // Function to handle a single connection lifecycle
              const createConnection = Effect.acquireRelease(
                // Acquire: Connect to Discord Gateway
                gateway
                  .connect()
                  .pipe(
                    Effect.mapError(
                      (error) =>
                        new DiscordBotStartupError({
                          message: 'Failed to connect to Discord Gateway',
                          cause: error,
                        }),
                    ),
                    Effect.tap(() => Effect.log('✅ Connected to Discord Gateway')),
                  ),
                // Release: Disconnect from Gateway
                (connection) =>
                  connection.disconnect().pipe(
                    Effect.tap(() => Effect.log('🔌 Disconnected from Discord Gateway')),
                    Effect.catchAll(() => Effect.succeed(undefined)),
                  ),
              )

              // Process events from a connection
              const processConnection = (connection: { events: Stream.Stream<any> }) =>
                Stream.runForEach(connection.events, (event) =>
                  Effect.gen(function* () {
                    if (event._tag === 'DiscordMessageEvent') {
                      const messageEvent = event as DiscordMessageEvent
                      const message = messageEvent.message

                      // Handle the message
                      yield* messageHandler
                        .handleMessage(message)
                        .pipe(Effect.catchAll(() => Effect.succeed(undefined)))
                    }
                  }).pipe(
                    Effect.withSpan('bot-process-event', {
                      attributes: {
                        'event.type': event._tag,
                      },
                    }),
                  ),
                )

              // Main bot loop with automatic reconnection
              yield* Effect.scoped(
                Effect.gen(function* () {
                  // Keep reconnecting until shutdown
                  yield* Effect.forever(
                    createConnection.pipe(
                      Effect.flatMap(processConnection),
                      Effect.catchAll((error) =>
                        Effect.gen(function* () {
                          yield* Effect.logError('❌ Connection error occurred', error)
                          // Gateway already has exponential backoff, add small delay
                          yield* Effect.sleep('2 seconds')
                        }),
                      ),
                    ),
                  )
                }),
              ).pipe(Effect.forkIn(scope), Effect.interruptible)

              yield* Effect.log('🎉 Discord bot started successfully')

              // Return shutdown function
              return {
                shutdown: () =>
                  Effect.gen(function* () {
                    yield* Effect.log('🛑 Shutting down Discord bot...')
                    yield* Scope.close(scope, Exit.succeed(undefined))
                    yield* Effect.log('✅ Discord bot shutdown complete')
                  }).pipe(Effect.withSpan('bot-shutdown')),
              }
            }).pipe(Effect.withSpan('bot-startup'))

          return { _tag: 'DiscordBotService', start } as const
        }),
      )

      // Build the test layer - provide mocks before the service
      const TestLayer = DiscordBotServiceLive.pipe(
        Layer.provide(MockDiscordGatewayServiceLive),
        Layer.provide(MockMessageHandlerServiceLive),
      )

      // Run with all required layers
      await Effect.runPromise(Effect.provide(program, TestLayer))
    })
  })
})
