import { Effect, Exit, Schema, Scope, Stream } from 'effect'
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

                // Handle the message - this starts a new root trace
                yield* messageHandler.handleMessage(message).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
              }
              // Other events (READY, etc.) can be traced separately if needed
            }),
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
              yield* Scope.close(scope, Exit.void)
              yield* Effect.log('✅ Discord bot shutdown complete')
            }).pipe(Effect.withSpan('bot-shutdown', { root: true })),
        }
      }).pipe(
        Effect.withSpan('bot.startup', {
          root: true,
          attributes: {
            'span.label': 'Bot startup',
            'bot.service': 'discord-bot-livestore',
          },
        }),
      )

    return { start } as const
  }),
  dependencies: [DiscordGatewayService.Default, MessageHandlerService.Default],
}) {}
