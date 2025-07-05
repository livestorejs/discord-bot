import { Data, Effect, Queue, Schema, Stream } from 'effect'
import WebSocket from 'ws'

/**
 * WebSocket connection state
 */
export type WebSocketState = Data.TaggedEnum<{
  Connecting: object
  Connected: object
  Disconnected: { readonly code: number; readonly reason: string }
  Failed: { readonly error: unknown }
}>

export const WebSocketState = Data.taggedEnum<WebSocketState>()

/**
 * WebSocket message types
 */
export class WebSocketTextMessage extends Schema.TaggedClass<WebSocketTextMessage>()('WebSocketTextMessage', {
  data: Schema.String,
}) {}

export class WebSocketBinaryMessage extends Schema.TaggedClass<WebSocketBinaryMessage>()('WebSocketBinaryMessage', {
  data: Schema.instanceOf(Buffer),
}) {}

export type WebSocketMessage = WebSocketTextMessage | WebSocketBinaryMessage

/**
 * WebSocket errors
 */
export class WebSocketConnectionError extends Schema.TaggedError<WebSocketConnectionError>()(
  'WebSocketConnectionError',
  {
    url: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export class WebSocketSendError extends Schema.TaggedError<WebSocketSendError>()('WebSocketSendError', {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

export class WebSocketStateError extends Schema.TaggedError<WebSocketStateError>()('WebSocketStateError', {
  message: Schema.String,
  currentState: Schema.Number,
  expectedState: Schema.String,
}) {}

export class WebSocketTimeoutError extends Schema.TaggedError<WebSocketTimeoutError>()('WebSocketTimeoutError', {
  message: Schema.String,
  timeout: Schema.String,
  url: Schema.String,
}) {}

/**
 * WebSocket connection interface
 */
export interface WebSocketConnection {
  readonly send: (message: string | Buffer) => Effect.Effect<void, WebSocketSendError | WebSocketStateError>
  readonly messages: Stream.Stream<WebSocketMessage, never>
  readonly state: Stream.Stream<WebSocketState, never>
  readonly close: (code?: number, reason?: string) => Effect.Effect<void>
}

/**
 * WebSocket service interface
 */
export class WebSocketService extends Effect.Service<WebSocketService>()('WebSocketService', {
  effect: Effect.gen(function* () {
    const connect = (url: string) =>
      Effect.acquireRelease(
        // Acquire: Create WebSocket connection and resources
        Effect.gen(function* () {
          // Create bounded queues with backpressure handling
          const messageQueue = yield* Queue.sliding<WebSocketMessage>(1000) // Keep last 1000 messages
          const stateQueue = yield* Queue.bounded<WebSocketState>(10) // Small queue for state changes

          // Create WebSocket instance
          const ws = new WebSocket(url)

          // Create connection promise
          const connectionResult = yield* Effect.async<
            { ws: WebSocket; messageQueue: Queue.Queue<WebSocketMessage>; stateQueue: Queue.Queue<WebSocketState> },
            WebSocketConnectionError
          >((resume) => {
            let isConnected = false
            const timeoutHandle: { current?: NodeJS.Timeout } = {}

            const cleanup = () => {
              if (timeoutHandle.current) {
                clearTimeout(timeoutHandle.current)
              }
              ws.removeAllListeners()
            }

            ws.once('open', () => {
              isConnected = true
              cleanup()
              Effect.runSync(Queue.offer(stateQueue, WebSocketState.Connected()))
              resume(Effect.succeed({ ws, messageQueue, stateQueue }))
            })

            ws.once('error', (error) => {
              if (!isConnected) {
                cleanup()
                resume(Effect.fail(new WebSocketConnectionError({ url, cause: error })))
              }
            })

            // Connection timeout
            timeoutHandle.current = setTimeout(() => {
              if (!isConnected) {
                cleanup()
                ws.terminate()
                resume(
                  Effect.fail(
                    new WebSocketConnectionError({
                      url,
                      cause: new Error('Connection timeout after 30s'),
                    }),
                  ),
                )
              }
            }, 30000)

            return Effect.sync(cleanup)
          })

          const { ws: connectedWs } = connectionResult

          // Set up persistent event handlers after connection
          connectedWs.on('error', (error) => {
            Effect.runSync(Queue.offer(stateQueue, WebSocketState.Failed({ error })))
          })

          connectedWs.on('close', (code, reason) => {
            Effect.runSync(
              Queue.offer(stateQueue, WebSocketState.Disconnected({ code, reason: reason.toString() })).pipe(
                Effect.andThen(Queue.shutdown(messageQueue)),
                Effect.andThen(Queue.shutdown(stateQueue)),
              ),
            )
          })

          connectedWs.on('message', (data, isBinary) => {
            const message = isBinary
              ? new WebSocketBinaryMessage({ data: data as Buffer })
              : new WebSocketTextMessage({ data: data.toString() })
            // Use offerAll to handle backpressure - will drop old messages if queue is full
            Effect.runSync(Queue.offer(messageQueue, message))
          })

          // Create connection interface
          const send = (message: string | Buffer) =>
            Effect.try({
              try: () => {
                if (connectedWs.readyState !== WebSocket.OPEN) {
                  throw new WebSocketStateError({
                    message: 'WebSocket is not in OPEN state',
                    currentState: connectedWs.readyState,
                    expectedState: 'OPEN',
                  })
                }
                connectedWs.send(message)
              },
              catch: (cause) => {
                if (cause instanceof WebSocketStateError) return cause
                return new WebSocketSendError({
                  message: 'Failed to send WebSocket message',
                  cause,
                })
              },
            }).pipe(
              Effect.withSpan('websocket-send', {
                attributes: {
                  'websocket.message_size': typeof message === 'string' ? message.length : message.byteLength,
                  'websocket.message_type': typeof message === 'string' ? 'text' : 'binary',
                },
              }),
            )

          const close = (code?: number, reason?: string) =>
            Effect.sync(() => {
              connectedWs.close(code, reason)
            })

          return {
            connection: {
              send,
              messages: Stream.fromQueue(messageQueue),
              state: Stream.fromQueue(stateQueue),
              close,
            } satisfies WebSocketConnection,
            ws: connectedWs,
            messageQueue,
            stateQueue,
          }
        }),
        // Release: Clean up resources
        ({ ws, messageQueue, stateQueue }) =>
          Effect.gen(function* () {
            yield* Effect.log(`Cleaning up WebSocket connection to ${url}`)

            // Close WebSocket if still open
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
              ws.close(1000, 'Normal closure')
            }

            // Terminate forcefully after a delay if needed
            yield* Effect.sleep('100 millis')
            if (ws.readyState !== WebSocket.CLOSED) {
              ws.terminate()
            }

            // Shutdown queues
            yield* Queue.shutdown(messageQueue)
            yield* Queue.shutdown(stateQueue)

            // Remove all listeners
            ws.removeAllListeners()
          }),
      ).pipe(
        Effect.map(({ connection }) => connection),
        Effect.withSpan('websocket-connect', {
          attributes: {
            'websocket.url': url,
          },
        }),
      )

    return { connect } as const
  }),
  dependencies: [],
}) {}
