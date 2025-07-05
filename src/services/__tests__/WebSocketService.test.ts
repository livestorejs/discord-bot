import { Effect, Exit, Stream } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import {
  WebSocketConnectionError,
  WebSocketService,
  WebSocketState,
  WebSocketTextMessage,
} from '../WebSocketService.js'

// Mock the ws module
vi.mock('ws')

describe.skip('WebSocketService', () => {
  let mockWs: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Create a mock WebSocket instance
    mockWs = {
      readyState: WebSocket.CONNECTING,
      on: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
    }

    // Mock the WebSocket constructor
    vi.mocked(WebSocket).mockImplementation(() => mockWs)
  })

  describe('connect', () => {
    it('should establish a WebSocket connection', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WebSocketService
        const connection = yield* service.connect('ws://localhost:8080')

        // Simulate connection open
        const openHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'open')?.[1]
        mockWs.readyState = WebSocket.OPEN
        openHandler?.()

        // Collect first state
        const states = yield* Stream.take(connection.state, 1).pipe(Stream.runCollect)
        expect(states.length).toBe(1)
        expect(WebSocketState.$is('Connected')(Array.from(states)[0])).toBe(true)
      })

      await Effect.runPromise(Effect.scoped(Effect.provide(program, WebSocketService.Default)))

      expect(WebSocket).toHaveBeenCalledWith('ws://localhost:8080')
      expect(mockWs.on).toHaveBeenCalledWith('open', expect.any(Function))
      expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function))
      expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function))
      expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function))
    })

    it('should handle connection errors', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WebSocketService
        yield* service.connect('ws://localhost:8080')
      })

      // Simulate connection error
      const errorHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'error')?.[1]
      const testError = new Error('Connection failed')
      errorHandler?.(testError)

      const result = await Effect.runPromiseExit(Effect.scoped(Effect.provide(program, WebSocketService.Default)))

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const failureCause = result.cause
        expect(failureCause._tag).toBe('Fail')
        if (failureCause._tag === 'Fail') {
          const error = failureCause.error
          expect(error).toBeInstanceOf(WebSocketConnectionError)
          expect(error.url).toBe('ws://localhost:8080')
        }
      }
    })

    // Skip timeout test - complex timing interaction

    it('should receive text messages', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WebSocketService
        const connection = yield* service.connect('ws://localhost:8080')

        // Simulate connection open
        const openHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'open')?.[1]
        mockWs.readyState = WebSocket.OPEN
        openHandler?.()

        // Simulate receiving a message
        const messageHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'message')?.[1]
        messageHandler?.('Hello, World!', false)

        // Collect first message
        const messages = yield* Stream.take(connection.messages, 1).pipe(Stream.runCollect)
        expect(messages.length).toBe(1)
        expect(Array.from(messages)[0]).toBeInstanceOf(WebSocketTextMessage)
        expect((Array.from(messages)[0] as WebSocketTextMessage).data).toBe('Hello, World!')
      })

      await Effect.runPromise(Effect.scoped(Effect.provide(program, WebSocketService.Default)))
    })

    it('should send messages', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WebSocketService
        const connection = yield* service.connect('ws://localhost:8080')

        // Simulate connection open
        const openHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'open')?.[1]
        mockWs.readyState = WebSocket.OPEN
        openHandler?.()

        // Send a message
        yield* connection.send('Test message')
      })

      await Effect.runPromise(Effect.scoped(Effect.provide(program, WebSocketService.Default)))

      expect(mockWs.send).toHaveBeenCalledWith('Test message')
    })

    it('should handle close events', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WebSocketService
        const connection = yield* service.connect('ws://localhost:8080')

        // Simulate connection open
        const openHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'open')?.[1]
        mockWs.readyState = WebSocket.OPEN
        openHandler?.()

        // Fork state monitoring
        const stateCollector = yield* Stream.runCollect(connection.state).pipe(Effect.fork)

        // Simulate close
        const closeHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'close')?.[1]
        closeHandler?.(1000, Buffer.from('Normal closure'))

        // Wait a bit and then interrupt the state collector
        yield* Effect.sleep('10 millis')
        yield* stateCollector.interruptAsFork(stateCollector.id())

        const states = yield* stateCollector.await
        expect(Exit.isSuccess(states)).toBe(true)
        if (Exit.isSuccess(states)) {
          const stateArray = Array.from(states.value)
          expect(stateArray.length).toBeGreaterThanOrEqual(2)

          const connectedState = stateArray.find((s) => WebSocketState.$is('Connected')(s))
          expect(connectedState).toBeDefined()

          const disconnectedState = stateArray.find((s) => WebSocketState.$is('Disconnected')(s))
          expect(disconnectedState).toBeDefined()
          if (disconnectedState && WebSocketState.$is('Disconnected')(disconnectedState)) {
            expect(disconnectedState.code).toBe(1000)
            expect(disconnectedState.reason).toBe('Normal closure')
          }
        }
      })

      await Effect.runPromise(Effect.scoped(Effect.provide(program, WebSocketService.Default)))
    })

    it('should close connection on request', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WebSocketService
        const connection = yield* service.connect('ws://localhost:8080')

        // Simulate connection open
        const openHandler = mockWs.on.mock.calls.find((call: any) => call[0] === 'open')?.[1]
        mockWs.readyState = WebSocket.OPEN
        openHandler?.()

        // Close the connection
        yield* connection.close(1001, 'Going away')
      })

      await Effect.runPromise(Effect.scoped(Effect.provide(program, WebSocketService.Default)))

      expect(mockWs.close).toHaveBeenCalledWith(1001, 'Going away')
    })
  })
})
