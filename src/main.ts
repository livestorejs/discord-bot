import { NodeRuntime } from '@effect/platform-node'
import { Effect, Layer, Logger } from 'effect'
import { DiscordBotService } from './services/DiscordBotService.js'
import { startHealthServer } from './services/HealthService.js'
import { MainLive } from './services/MainLive.js'
import { ObservabilityLive } from './services/ObservabilityService.js'

/**
 * Main application entry point using Effect
 */
const program = Effect.gen(function* () {
  yield* Effect.log('🚀 Starting Discord ThreadBot...')

  // Start health server
  const healthServer = yield* startHealthServer()

  // Get the bot service
  const botService = yield* DiscordBotService

  // Start the bot
  const { shutdown } = yield* botService['start']()

  // Set up graceful shutdown
  const shutdownHandler = () =>
    Effect.gen(function* () {
      yield* Effect.log('🔔 Received shutdown signal, shutting down gracefully...')
      yield* shutdown()
      yield* healthServer.shutdown()
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
})

// Combine all layers
const AppLive = Layer.merge(MainLive, ObservabilityLive).pipe(
  Layer.provide(Logger.pretty),
)

// Run the program
NodeRuntime.runMain(program.pipe(Effect.provide(AppLive)))
