import { NodeRuntime } from '@effect/platform-node'
import { Effect, Logger } from 'effect'
import { DiscordBotService } from './services/DiscordBotService.js'
import { MainLive } from './services/MainLive.js'

/**
 * Main application entry point using Effect
 */
const program = Effect.gen(function* () {
  yield* Effect.log('🚀 Starting Discord ThreadBot...')

  // Get the bot service
  const botService = yield* DiscordBotService

  // Start the bot
  const { shutdown } = yield* botService['start']()

  // Set up graceful shutdown
  const shutdownHandler = () =>
    Effect.gen(function* () {
      yield* Effect.log('🔔 Received shutdown signal, shutting down gracefully...')
      yield* shutdown()
      yield* Effect.log('👋 Goodbye!')
    }).pipe(Effect.withSpan('main-shutdown-handler'))

  // Register shutdown handlers
  process.on('SIGINT', () => {
    Effect.runPromise(shutdownHandler()).then(() => process.exit(0))
  })
  process.on('SIGTERM', () => {
    Effect.runPromise(shutdownHandler()).then(() => process.exit(0))
  })
  process.on('SIGHUP', () => {
    Effect.runPromise(shutdownHandler()).then(() => process.exit(0))
  })

  // Keep the process alive
  yield* Effect.never
}).pipe(Effect.withSpan('main-program'))

// Run the program
NodeRuntime.runMain(program.pipe(Effect.provide(MainLive), Effect.provide(Logger.pretty)))
