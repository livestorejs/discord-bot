import { Effect, Layer, Queue, Stream } from 'effect'
import { AiService } from '../AiService.js'
import { DiscordApiService } from '../DiscordApiService.js'
import { type DiscordEvent, DiscordGatewayService, type DiscordMessage } from '../DiscordGatewayService.js'
import { MessageHandlerService } from '../MessageHandlerService.js'

/**
 * Create a mock MessageHandlerService
 */
export const createMockMessageHandler = (
  handleMessage: (message: DiscordMessage) => Effect.Effect<void, any, never>,
) => {
  return Layer.succeed(MessageHandlerService, { _tag: 'MessageHandlerService', handleMessage } as MessageHandlerService)
}

/**
 * Create a mock DiscordGatewayService
 */
export const createMockGateway = (events: Stream.Stream<DiscordEvent, never, never>) => {
  return Layer.succeed(DiscordGatewayService, {
    _tag: 'DiscordGatewayService',
    connect: () =>
      Effect.succeed({
        events,
        disconnect: () => Effect.succeed(undefined),
      }),
  } as unknown as DiscordGatewayService)
}

/**
 * Create a mock DiscordGatewayService with controllable events
 */
export const createMockGatewayWithEvents = (eventList: DiscordEvent[]) => {
  return Layer.effect(
    DiscordGatewayService,
    Effect.gen(function* () {
      const eventQueue = yield* Queue.unbounded<DiscordEvent>()

      return {
        _tag: 'DiscordGatewayService',
        connect: () =>
          Effect.gen(function* () {
            // Immediately queue all events
            for (const event of eventList) {
              yield* Queue.offer(eventQueue, event)
            }

            return {
              events: Stream.fromQueue(eventQueue),
              disconnect: () => Effect.succeed(undefined),
            }
          }),
        connectDirect: () =>
          Effect.gen(function* () {
            for (const event of eventList) {
              yield* Queue.offer(eventQueue, event)
            }
            return {
              events: Stream.fromQueue(eventQueue),
              disconnect: () => Effect.succeed(undefined),
            }
          }),
        reconnect: () =>
          Effect.gen(function* () {
            for (const event of eventList) {
              yield* Queue.offer(eventQueue, event)
            }
            return {
              events: Stream.fromQueue(eventQueue),
              disconnect: () => Effect.succeed(undefined),
            }
          }),
      } as unknown as DiscordGatewayService
    }),
  )
}

/**
 * Create a mock AiService
 */
export const createMockAiService = (summarizeMessage: (content: string) => Effect.Effect<string, any, never>) => {
  return Layer.succeed(AiService, { _tag: 'AiService', summarizeMessage } as AiService)
}

/**
 * Create a mock DiscordApiService
 */
export const createMockDiscordApi = (
  createThread: (channelId: string, messageId: string, threadName: string) => Effect.Effect<void, any, never>,
) => {
  return Layer.succeed(DiscordApiService, { _tag: 'DiscordApiService', createThread } as DiscordApiService)
}
