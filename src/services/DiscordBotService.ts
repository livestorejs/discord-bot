import { Effect, Fiber, Schedule, Schema, Stream } from 'effect'
import { DiscordGatewayService, type DiscordMessageEvent } from './DiscordGatewayService.js'
import { MessageHandlerService } from './MessageHandlerService.js'

/**
 * Discord Bot errors
 */
export class DiscordBotStartupError extends Schema.TaggedError<DiscordBotStartupError>()('DiscordBotStartupError', {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

/**
 * Bot shutdown interface
 */
export interface BotShutdown {
  readonly shutdown: () => Effect.Effect<void, never, never>
}

/**
 * Discord Bot service that orchestrates the gateway and message handling
 */
export class DiscordBotService extends Effect.Service<DiscordBotService>()('DiscordBotService', {
  effect: Effect.gen(function* () {
    const gateway = yield* DiscordGatewayService
    const messageHandler = yield* MessageHandlerService

    const start = (): Effect.Effect<BotShutdown, DiscordBotStartupError> =>
      Effect.gen(function* () {
        yield* Effect.log('🚀 Starting Discord bot...')

        let isShuttingDown = false
        let currentConnection: { disconnect: () => Effect.Effect<void> } | null = null

        // Function to establish connection and process events
        const connectAndProcess = Effect.gen(function* () {
          // Connect to Discord Gateway
          const connection = yield* gateway.connect().pipe(
            Effect.mapError(
              (error) =>
                new DiscordBotStartupError({
                  message: 'Failed to connect to Discord Gateway',
                  cause: error,
                }),
            ),
          )

          currentConnection = connection

          // Process messages until connection closes
          yield* Stream.runForEach(connection.events, (event) =>
            Effect.gen(function* () {
              if (event._tag === 'DiscordMessageEvent') {
                const messageEvent = event as DiscordMessageEvent
                const message = messageEvent.message

                // Handle the message
                yield* messageHandler.handleMessage(message).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
              }
            }).pipe(
              Effect.withSpan('bot-process-event', {
                attributes: {
                  'event.type': event._tag,
                },
              }),
            ),
          )
        })

        // Start the connection loop with automatic reconnection
        const connectionLoop = yield* Effect.repeat(
          connectAndProcess.pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                if (!isShuttingDown) {
                  yield* Effect.logError('❌ Connection error occurred', error)
                  // Error already includes exponential backoff from gateway.connect()
                  // Just add a small delay before the next attempt
                  yield* Effect.sleep('2 seconds')
                }
              }),
            ),
          ),
          {
            while: () => !isShuttingDown,
            schedule: Schedule.forever,
          },
        ).pipe(Effect.forkDaemon)

        yield* Effect.log('🎉 Discord bot started successfully')

        // Return shutdown function
        return {
          shutdown: () =>
            Effect.gen(function* () {
              yield* Effect.log('🛑 Shutting down Discord bot...')
              isShuttingDown = true
              yield* Fiber.interrupt(connectionLoop)
              if (currentConnection) {
                yield* currentConnection.disconnect()
              }
              yield* Effect.log('✅ Discord bot shutdown complete')
            }).pipe(Effect.withSpan('bot-shutdown')),
        }
      }).pipe(Effect.withSpan('bot-startup'))

    return { start } as const
  }),
  dependencies: [DiscordGatewayService.Default, MessageHandlerService.Default],
}) {}
