import * as Discord from 'discord-api-types/v10'
import { Effect, Queue, Ref, Schedule, Schema, Stream } from 'effect'
import { ConfigService } from './ConfigService.js'
import { updateGatewayStatus } from './HealthService.js'
import * as SimpleConnectionManager from './SimpleConnectionManager.js'
import { type WebSocketConnection, WebSocketService, WebSocketState, WebSocketTextMessage } from './WebSocketService.js'

/**
 * Discord Gateway errors
 */
export class DiscordGatewayError extends Schema.TaggedError<DiscordGatewayError>()('DiscordGatewayError', {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

export class InvalidTokenError extends Schema.TaggedError<InvalidTokenError>()('InvalidTokenError', {
  message: Schema.String,
}) {}

export class GatewayUrlError extends Schema.TaggedError<GatewayUrlError>()('GatewayUrlError', {
  message: Schema.String,
  status: Schema.Number,
  cause: Schema.Unknown,
}) {}

/**
 * Discord Gateway events
 */
export class DiscordGatewayEvent extends Schema.TaggedClass<DiscordGatewayEvent>()('DiscordGatewayEvent', {
  payload: Schema.Unknown,
}) {}

// Minimal Discord message schema - we only decode what we need
export const DiscordMessageSchema = Schema.Struct({
  id: Schema.String,
  channel_id: Schema.String,
  author: Schema.Struct({
    id: Schema.String,
    username: Schema.String,
    discriminator: Schema.String,
    avatar: Schema.NullOr(Schema.String),
    bot: Schema.optional(Schema.Boolean),
    global_name: Schema.NullOr(Schema.String),
  }),
  content: Schema.String,
  timestamp: Schema.String,
  edited_timestamp: Schema.NullOr(Schema.String),
  tts: Schema.Boolean,
  mention_everyone: Schema.Boolean,
  mentions: Schema.Array(Schema.Unknown),
  mention_roles: Schema.Array(Schema.String),
  attachments: Schema.Array(Schema.Unknown),
  embeds: Schema.Array(Schema.Unknown),
  pinned: Schema.Boolean,
  type: Schema.Number,
  message_reference: Schema.optional(
    Schema.Struct({
      channel_id: Schema.String,
      message_id: Schema.optional(Schema.String),
    }),
  ),
})

export type DiscordMessage = typeof DiscordMessageSchema.Type

export class DiscordMessageEvent extends Schema.TaggedClass<DiscordMessageEvent>()('DiscordMessageEvent', {
  message: DiscordMessageSchema,
}) {}

// Discord Interaction schemas - simplified for now
export const InteractionSchema = Schema.Struct({
  id: Schema.String,
  application_id: Schema.String,
  type: Schema.Number,
  data: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    type: Schema.Number,
    options: Schema.optional(
      Schema.Array(
        Schema.Struct({
          name: Schema.String,
          value: Schema.Union(Schema.String, Schema.Number, Schema.Boolean),
          type: Schema.Number,
        }),
      ),
    ),
  }),
  channel_id: Schema.String,
  token: Schema.String,
  user: Schema.Struct({
    id: Schema.String,
    username: Schema.String,
    discriminator: Schema.String,
  }),
})

export type DiscordInteraction = typeof InteractionSchema.Type

export class DiscordInteractionEvent extends Schema.TaggedClass<DiscordInteractionEvent>()('DiscordInteractionEvent', {
  interaction: InteractionSchema,
}) {}

export type DiscordEvent = DiscordGatewayEvent | DiscordMessageEvent | DiscordInteractionEvent

/**
 * Gateway connection interface
 */
export interface GatewayConnection {
  readonly events: Stream.Stream<DiscordEvent, never>
  readonly disconnect: () => Effect.Effect<void>
}

/**
 * Gateway connection state
 */
interface GatewayState {
  seq: number | null
  sessionId: string | null
  heartbeatInterval: number | null
  heartbeatAcknowledged: boolean
}

/**
 * Discord Gateway service
 */
export class DiscordGatewayService extends Effect.Service<DiscordGatewayService>()('DiscordGatewayService', {
  effect: Effect.gen(function* () {
    const config = yield* ConfigService
    const websocket = yield* WebSocketService

    const connect = () =>
      Effect.gen(function* () {
        // Get gateway URL
        const gatewayUrl = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch('https://discord.com/api/v10/gateway/bot', {
              headers: { Authorization: config.getBotDiscordToken() },
            })

            if (response.status === 401) {
              throw new InvalidTokenError({ message: 'Invalid Discord bot token' })
            }

            if (!response.ok) {
              throw new GatewayUrlError({
                message: `Failed to get gateway URL: ${response.status}`,
                status: response.status,
                cause: response.statusText,
              })
            }

            const data = (await response.json()) as { url: string }
            return data.url
          },
          catch: (error) => {
            if (error instanceof InvalidTokenError) return error
            if (error instanceof GatewayUrlError) return error
            return new DiscordGatewayError({
              message: 'Failed to get Discord gateway URL',
              cause: error,
            })
          },
        })

        // Connect to WebSocket
        const wsUrl = `${gatewayUrl}?v=10&encoding=json`
        const connection = yield* websocket.connect(wsUrl).pipe(
          Effect.mapError(
            (error) =>
              new DiscordGatewayError({
                message: 'Failed to connect to Discord gateway',
                cause: error,
              }),
          ),
        )

        // Gateway state
        const stateRef = yield* Ref.make<GatewayState>({
          seq: null,
          sessionId: null,
          heartbeatInterval: null,
          heartbeatAcknowledged: true,
        })

        // Event queue with bounded capacity to prevent memory issues
        // Using sliding queue to keep most recent events if processing falls behind
        const eventQueue = yield* Queue.sliding<DiscordEvent>(5000)

        // Handle incoming messages
        const messageHandler = Stream.runForEach(connection.messages, (msg) =>
          Effect.gen(function* () {
            if (!(msg instanceof WebSocketTextMessage)) return

            const payload = yield* Schema.decode(
              Schema.parseJson(Schema.Any as Schema.Schema<Discord.GatewayReceivePayload>),
            )(msg.data)

            // Update sequence number
            if ('s' in payload && payload.s !== null) {
              yield* Ref.update(stateRef, (state) => ({ ...state, seq: payload.s }))
            }

            // Handle different opcodes
            switch (payload.op) {
              case Discord.GatewayOpcodes.Hello: {
                // Start heartbeat
                const interval = (payload.d as { heartbeat_interval: number }).heartbeat_interval
                yield* Ref.update(stateRef, (state) => ({ ...state, heartbeatInterval: interval }))
                yield* startHeartbeat(connection, stateRef, interval)

                // Send identify
                yield* identify(connection, config.getRawDiscordToken())
                break
              }

              case Discord.GatewayOpcodes.Dispatch: {
                const dispatchPayload = payload as Discord.GatewayDispatchPayload

                if (dispatchPayload.t === 'READY') {
                  const readyData = dispatchPayload.d as Discord.GatewayReadyDispatchData
                  yield* Ref.update(stateRef, (state) => ({ ...state, sessionId: readyData.session_id }))
                  yield* Effect.log('🎯 Discord Gateway connected and ready')
                  // Update health status - we're connected!
                  yield* updateGatewayStatus(true)
                } else if (dispatchPayload.t === 'MESSAGE_CREATE') {
                  const message = dispatchPayload.d
                  yield* Queue.offer(eventQueue, new DiscordMessageEvent({ message }))
                } else if (dispatchPayload.t === 'INTERACTION_CREATE') {
                  const interaction = dispatchPayload.d as any
                  // Only handle slash commands for now (type 2)
                  if (interaction.type === 2) {
                    yield* Queue.offer(eventQueue, new DiscordInteractionEvent({ interaction }))
                  }
                }

                // Emit generic event for all dispatches
                yield* Queue.offer(eventQueue, new DiscordGatewayEvent({ payload }))
                break
              }

              case Discord.GatewayOpcodes.HeartbeatAck: {
                yield* Ref.update(stateRef, (state) => ({ ...state, heartbeatAcknowledged: true }))
                // Update health status with successful heartbeat
                yield* updateGatewayStatus(true)
                break
              }

              case Discord.GatewayOpcodes.Reconnect: {
                yield* Effect.log('🔄 Discord requested reconnect')
                yield* connection.close(1000, 'Reconnect requested')
                break
              }

              case Discord.GatewayOpcodes.InvalidSession: {
                yield* Effect.logError('❌ Invalid session received from Discord')
                yield* connection.close(4000, 'Invalid session')
                break
              }
            }
          }),
        )

        // Handle connection state changes and trigger reconnection
        const stateHandler = Stream.runForEach(connection.state, (state) =>
          Effect.gen(function* () {
            if (WebSocketState.$is('Disconnected')(state)) {
              yield* Effect.log(`🔌 Discord Gateway disconnected: ${state.code} - ${state.reason}`)
              // Update health status - we're disconnected
              yield* updateGatewayStatus(false)

              // Check if we should reconnect based on close code
              if (SimpleConnectionManager.shouldReconnect(state.code)) {
                const delay = SimpleConnectionManager.getReconnectDelay(state.code)
                yield* Effect.log(`🔄 Will attempt to reconnect in ${delay}`)

                // Close the event queue to signal disconnection
                yield* Queue.shutdown(eventQueue)
              } else {
                yield* Effect.logError(`❌ Fatal error (code ${state.code}), will not reconnect`)
              }
            } else if (WebSocketState.$is('Failed')(state)) {
              yield* Effect.logError('❌ Discord Gateway connection failed', state.error)
              // Update health status - connection failed
              yield* updateGatewayStatus(false)
              yield* Queue.shutdown(eventQueue)
            }
          }),
        )

        // Run handlers in background
        yield* Effect.forkDaemon(messageHandler)
        yield* Effect.forkDaemon(stateHandler)

        return {
          events: Stream.fromQueue(eventQueue),
          disconnect: () => connection.close(1000, 'Client disconnect'),
        }
      })

    // Enhanced connect with exponential backoff
    const connectWithBackoff = () =>
      SimpleConnectionManager.withExponentialBackoff(
        connect(),
        10, // max attempts
        '1 second', // base delay
        '120 seconds', // max delay
      ).pipe(
        Effect.tapError((error) =>
          Effect.logError('❌ Failed to establish Discord Gateway connection after all retries', error),
        ),
        // This creates a new root trace for the entire reconnection sequence
        Effect.withSpan('gateway.reconnect', {
          root: true,
          attributes: {
            'span.label': 'Gateway reconnection',
            'reconnect.max_attempts': 10,
            'reconnect.base_delay': '1 second',
            'reconnect.max_delay': '120 seconds',
          },
        }),
      )

    // Manual reconnection with proper delay
    const reconnect = (reason?: string) => SimpleConnectionManager.handleDisconnection(connect(), reason, '2 seconds')

    return {
      connect: connectWithBackoff,
      connectDirect: connect, // Keep original for testing
      reconnect,
    } as const
  }),
  dependencies: [ConfigService.Default, WebSocketService.Default],
}) {}

/**
 * Send identify payload
 */
const identify = (connection: WebSocketConnection, token: string) =>
  Effect.gen(function* () {
    const payload: Discord.GatewayIdentify = {
      op: Discord.GatewayOpcodes.Identify,
      d: {
        token,
        intents:
          Discord.GatewayIntentBits.GuildMessages |
          Discord.GatewayIntentBits.MessageContent |
          Discord.GatewayIntentBits.Guilds,
        properties: {
          os: 'linux',
          browser: 'discord-bot',
          device: 'discord-bot',
        },
      },
    }

    yield* connection.send(JSON.stringify(payload))
    yield* Effect.log('🔐 Sent identify payload to Discord')
  }).pipe(Effect.withSpan('discord-gateway-identify'))

/**
 * Start heartbeat interval
 */
const startHeartbeat = (connection: WebSocketConnection, stateRef: Ref.Ref<GatewayState>, interval: number) =>
  Effect.gen(function* () {
    yield* Effect.log(`💓 Starting heartbeat every ${interval}ms`)

    let cycleCount = 0

    yield* Effect.repeat(
      Effect.gen(function* () {
        cycleCount++
        const cycleStartTime = Date.now()

        // Start a new trace for each heartbeat cycle
        yield* Effect.gen(function* () {
          const state = yield* Ref.get(stateRef)

          // Check if last heartbeat was acknowledged
          if (!state.heartbeatAcknowledged) {
            yield* Effect.logWarning('⚠️ Heartbeat not acknowledged, connection may be stale')
          }

          // Send heartbeat
          const payload: Discord.GatewayHeartbeat = {
            op: Discord.GatewayOpcodes.Heartbeat,
            d: state.seq,
          }

          yield* connection.send(JSON.stringify(payload)).pipe(Effect.withSpan('heartbeat.send'))
          yield* Ref.update(stateRef, (s) => ({ ...s, heartbeatAcknowledged: false }))

          // The ACK will be received in the message handler and update heartbeatAcknowledged
          // We'll track the latency when we receive the ACK
        }).pipe(
          Effect.withSpan('gateway.heartbeat_cycle', {
            root: true,
            attributes: {
              'span.label': `Heartbeat cycle #${cycleCount}`,
              'heartbeat.interval_ms': interval,
              'heartbeat.sequence': cycleCount,
              'heartbeat.timestamp': cycleStartTime,
            },
          }),
        )
      }),
      {
        schedule: Schedule.fixed(interval),
      },
    ).pipe(Effect.forkDaemon)
  })
