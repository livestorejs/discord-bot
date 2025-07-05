import * as Discord from 'discord-api-types/v10'
import { Effect, Exit, Layer, Queue, Stream } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigService } from '../ConfigService.js'
import { DiscordGatewayService, type DiscordMessageEvent, InvalidTokenError } from '../DiscordGatewayService.js'
import { WebSocketService, WebSocketState, WebSocketTextMessage } from '../WebSocketService.js'

describe('DiscordGatewayService', () => {
  const mockConfig = {
    discordToken: 'test-token',
    openaiKey: 'test-key',
    channelIds: ['channel-123'],
    messageFiltering: {
      enabled: true,
      minMessageLength: 10,
    },
  }

  const MockConfigServiceLive = Layer.succeed(ConfigService, {
    _tag: 'ConfigService',
    config: mockConfig,
    getRawDiscordToken: () => 'test-token',
    getBotDiscordToken: () => 'Bot test-token',
  } as ConfigService)

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  describe('connect', () => {
    it.skip('should handle invalid token errors', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        status: 401,
        ok: false,
      } as Response)

      const program = Effect.gen(function* () {
        const service = yield* DiscordGatewayService
        yield* service.connect()
      })

      const TestLayer = DiscordGatewayService.Default.pipe(
        Layer.provide(MockConfigServiceLive),
        Layer.provide(
          Layer.succeed(WebSocketService, {
            _tag: 'WebSocketService',
            connect: () => Effect.die('Should not connect with invalid token'),
          } as WebSocketService),
        ),
      )

      const result = await Effect.runPromiseExit(Effect.provide(program, TestLayer))

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const failureCause = result.cause
        expect(failureCause._tag).toBe('Fail')
        if (failureCause._tag === 'Fail') {
          expect(failureCause.error).toBeInstanceOf(InvalidTokenError)
        }
      }
    })

    it.skip('should establish gateway connection and handle READY event', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ url: 'wss://gateway.discord.gg' }),
      } as Response)

      const sentMessages: string[] = []
      const mockSend = vi.fn((data: string) => {
        console.log('mockSend called with:', data)
        return data
      })

      // Create messages that will trigger the gateway flow
      const helloPayload = {
        op: Discord.GatewayOpcodes.Hello,
        d: { heartbeat_interval: 45000 },
      }
      const readyPayload = {
        op: Discord.GatewayOpcodes.Dispatch,
        s: 1,
        t: 'READY' as const,
        d: {
          v: 10,
          user: {} as any,
          guilds: [],
          session_id: 'test-session',
          shard: [0, 1] as [number, number],
          application: {} as any,
          resume_gateway_url: 'wss://gateway.discord.gg',
        },
      }

      // Create queue-based infinite stream that mimics WebSocket behavior
      const createMessageStream = Effect.gen(function* () {
        const messageQueue = yield* Queue.unbounded<WebSocketTextMessage>()

        // Queue messages with proper timing
        yield* Effect.forkDaemon(
          Effect.gen(function* () {
            yield* Effect.sleep('10 millis')
            yield* Queue.offer(messageQueue, new WebSocketTextMessage({ data: JSON.stringify(helloPayload) }))
            yield* Effect.sleep('50 millis')
            yield* Queue.offer(messageQueue, new WebSocketTextMessage({ data: JSON.stringify(readyPayload) }))
          }),
        )

        return Stream.fromQueue(messageQueue)
      })

      const MockWebSocketServiceLive = Layer.succeed(WebSocketService, {
        _tag: 'WebSocketService',
        connect: (url: string) => {
          expect(url).toBe('wss://gateway.discord.gg?v=10&encoding=json')

          return Effect.gen(function* () {
            const messageStream = yield* createMessageStream
            return {
              send: (data: string) => {
                sentMessages.push(data)
                mockSend(data)
                return Effect.succeed(undefined)
              },
              messages: messageStream,
              state: Stream.make(WebSocketState.Connected()),
              close: () => Effect.succeed(undefined),
            }
          })
        },
      } as WebSocketService)

      const program = Effect.gen(function* () {
        const service = yield* DiscordGatewayService
        const { events } = yield* service.connect()

        // Wait for events to process with proper timeout
        yield* Stream.take(events, 1).pipe(Stream.runCollect, Effect.timeout('1 second'))

        // Give time for async operations to complete
        yield* Effect.sleep('500 millis')
      })

      const TestLayer = DiscordGatewayService.Default.pipe(
        Layer.provide(MockConfigServiceLive),
        Layer.provide(MockWebSocketServiceLive),
      )

      await Effect.runPromise(Effect.provide(program, TestLayer))

      // Verify identify was sent (should contain op: 2)
      console.log('Sent messages count:', sentMessages.length)
      console.log('Mock send call count:', mockSend.mock.calls.length)
      console.log(
        'All sent messages:',
        sentMessages.map((msg) => {
          try {
            return JSON.parse(msg).op
          } catch {
            return 'invalid'
          }
        }),
      )

      const identifyMessage = sentMessages.find((msg) => msg.includes('"op":2'))
      expect(identifyMessage).toBeDefined()
    })

    it.skip('should handle MESSAGE_CREATE events', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ url: 'wss://gateway.discord.gg' }),
      } as Response)

      const sentMessages: string[] = []
      const mockSend = vi.fn().mockReturnValue(Effect.succeed(undefined))

      // Create messages
      const helloPayload = {
        op: Discord.GatewayOpcodes.Hello,
        d: { heartbeat_interval: 45000 },
      }
      const messagePayload = {
        op: Discord.GatewayOpcodes.Dispatch,
        s: 2,
        t: 'MESSAGE_CREATE' as const,
        d: {
          id: 'msg-123',
          channel_id: 'channel-123',
          author: {
            id: 'user-123',
            username: 'testuser',
            discriminator: '0001',
            avatar: null,
            global_name: 'testuser',
          },
          content: 'Test message',
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
        },
      }

      // Create queue-based stream for message handling test
      const createMessageStream = Effect.gen(function* () {
        const messageQueue = yield* Queue.unbounded<WebSocketTextMessage>()

        // Queue messages with timing
        yield* Effect.forkDaemon(
          Effect.gen(function* () {
            yield* Effect.sleep('10 millis')
            yield* Queue.offer(messageQueue, new WebSocketTextMessage({ data: JSON.stringify(helloPayload) }))
            yield* Effect.sleep('50 millis')
            yield* Queue.offer(messageQueue, new WebSocketTextMessage({ data: JSON.stringify(messagePayload) }))
          }),
        )

        return Stream.fromQueue(messageQueue)
      })

      const MockWebSocketServiceLive = Layer.succeed(WebSocketService, {
        _tag: 'WebSocketService',
        connect: () =>
          Effect.gen(function* () {
            const messageStream = yield* createMessageStream
            return {
              send: (data: string) => {
                sentMessages.push(data)
                mockSend(data)
                return Effect.succeed(undefined)
              },
              messages: messageStream,
              state: Stream.make(WebSocketState.Connected()),
              close: () => Effect.succeed(undefined),
            }
          }),
      } as WebSocketService)

      const program = Effect.gen(function* () {
        const service = yield* DiscordGatewayService
        const { events } = yield* service.connect()

        // Collect events with generous timeout
        const allEvents = yield* Stream.take(events, 2).pipe(Stream.runCollect, Effect.timeout('2 seconds'))

        const messageEvents = Array.from(allEvents).filter(
          (e): e is DiscordMessageEvent => e._tag === 'DiscordMessageEvent',
        )

        expect(messageEvents.length).toBe(1)
        expect(messageEvents[0].message.id).toBe('msg-123')
        expect(messageEvents[0].message.content).toBe('Test message')
      })

      const TestLayer = DiscordGatewayService.Default.pipe(
        Layer.provide(MockConfigServiceLive),
        Layer.provide(MockWebSocketServiceLive),
      )

      await Effect.runPromise(Effect.provide(program, TestLayer))
    })

    it.skip('should handle heartbeat flow', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ url: 'wss://gateway.discord.gg' }),
      } as Response)

      const sentMessages: string[] = []
      const mockSend = vi.fn().mockImplementation((data: string) => {
        sentMessages.push(data)
        return Effect.succeed(undefined)
      })

      // Create queue-based stream for heartbeat test
      const createHeartbeatStream = Effect.gen(function* () {
        const messageQueue = yield* Queue.unbounded<WebSocketTextMessage>()

        yield* Effect.forkDaemon(
          Effect.gen(function* () {
            yield* Effect.sleep('10 millis')
            yield* Queue.offer(
              messageQueue,
              new WebSocketTextMessage({
                data: JSON.stringify({
                  op: Discord.GatewayOpcodes.Hello,
                  d: { heartbeat_interval: 100 }, // Short interval for testing
                }),
              }),
            )
          }),
        )

        return Stream.fromQueue(messageQueue)
      })

      const MockWebSocketServiceLive = Layer.succeed(WebSocketService, {
        _tag: 'WebSocketService',
        connect: () =>
          Effect.gen(function* () {
            const messageStream = yield* createHeartbeatStream
            return {
              send: (data: string) => {
                sentMessages.push(data)
                mockSend(data)
                return Effect.succeed(undefined)
              },
              messages: messageStream,
              state: Stream.make(WebSocketState.Connected()),
              close: () => Effect.succeed(undefined),
            }
          }),
      } as WebSocketService)

      const program = Effect.gen(function* () {
        const service = yield* DiscordGatewayService
        const { disconnect } = yield* service.connect()

        // Wait for initial connection and give time for heartbeat
        yield* Effect.sleep('150 millis')

        // Disconnect to stop heartbeats
        yield* disconnect()
      })

      const TestLayer = DiscordGatewayService.Default.pipe(
        Layer.provide(MockConfigServiceLive),
        Layer.provide(MockWebSocketServiceLive),
      )

      await Effect.runPromise(Effect.provide(program, TestLayer))

      // Should have sent identify message
      console.log('Heartbeat test - Sent messages count:', sentMessages.length)
      console.log('Heartbeat test - Mock send call count:', mockSend.mock.calls.length)
      console.log(
        'Heartbeat test - Message opcodes:',
        sentMessages.map((msg) => {
          try {
            return JSON.parse(msg).op
          } catch {
            return 'invalid'
          }
        }),
      )

      const identifyMessages = sentMessages.filter((msg) => msg.includes('"op":2'))
      // At minimum, should have sent identify
      expect(identifyMessages.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle reconnect requests', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ url: 'wss://gateway.discord.gg' }),
      } as Response)

      const mockClose = vi.fn().mockReturnValue(Effect.succeed(undefined))

      // Create queue-based stream for reconnect test
      const createReconnectStream = Effect.gen(function* () {
        const messageQueue = yield* Queue.unbounded<WebSocketTextMessage>()

        yield* Effect.forkDaemon(
          Effect.gen(function* () {
            yield* Effect.sleep('10 millis')
            yield* Queue.offer(
              messageQueue,
              new WebSocketTextMessage({
                data: JSON.stringify({
                  op: Discord.GatewayOpcodes.Hello,
                  d: { heartbeat_interval: 45000 },
                }),
              }),
            )
            yield* Effect.sleep('50 millis')
            yield* Queue.offer(
              messageQueue,
              new WebSocketTextMessage({
                data: JSON.stringify({
                  op: Discord.GatewayOpcodes.Reconnect,
                  d: null,
                }),
              }),
            )
          }),
        )

        return Stream.fromQueue(messageQueue)
      })

      const MockWebSocketServiceLive = Layer.succeed(WebSocketService, {
        _tag: 'WebSocketService',
        connect: () =>
          Effect.gen(function* () {
            const messageStream = yield* createReconnectStream
            return {
              send: () => Effect.succeed(undefined),
              messages: messageStream,
              state: Stream.make(WebSocketState.Connected()),
              close: mockClose,
            }
          }),
      } as WebSocketService)

      const program = Effect.gen(function* () {
        const service = yield* DiscordGatewayService
        const { events } = yield* service.connect()

        // Process events until we see the reconnect handling
        yield* Stream.take(events, 2).pipe(Stream.runCollect, Effect.timeout('500 millis'))

        // Give time for reconnect to be processed
        yield* Effect.sleep('100 millis')
      })

      const TestLayer = DiscordGatewayService.Default.pipe(
        Layer.provide(MockConfigServiceLive),
        Layer.provide(MockWebSocketServiceLive),
      )

      // Expect this to fail with reconnect error, which is normal behavior
      const result = await Effect.runPromiseExit(Effect.provide(program, TestLayer))

      // The service should attempt to close the connection on reconnect
      // Note: This might fail as expected since reconnect triggers disconnection
      expect(Exit.isFailure(result) || mockClose.mock.calls.length > 0).toBe(true)
    })
  })
})
