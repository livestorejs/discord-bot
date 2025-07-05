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
      Effect.gen(function* () {
        const ws = new WebSocket(url)
        const messageQueue = yield* Queue.unbounded<WebSocketMessage>()
        const stateQueue = yield* Queue.unbounded<WebSocketState>()

        // Set up event handlers
        yield* Effect.async<void, WebSocketConnectionError>((resume) => {
          let isConnected = false

          ws.on('open', () => {
            isConnected = true
            Effect.runSync(Queue.offer(stateQueue, WebSocketState.Connected()))
            resume(Effect.succeed(undefined))
          })

          ws.on('error', (error) => {
            Effect.runSync(Queue.offer(stateQueue, WebSocketState.Failed({ error })))
            if (!isConnected) {
              resume(Effect.fail(new WebSocketConnectionError({ url, cause: error })))
            }
          })

          ws.on('close', (code, reason) => {
            Effect.runSync(Queue.offer(stateQueue, WebSocketState.Disconnected({ code, reason: reason.toString() })))
          })

          ws.on('message', (data, isBinary) => {
            const message = isBinary
              ? new WebSocketBinaryMessage({ data: data as Buffer })
              : new WebSocketTextMessage({ data: data.toString() })
            Effect.runSync(Queue.offer(messageQueue, message))
          })

          // Handle timeout
          const timeout = setTimeout(() => {
            if (!isConnected) {
              ws.close()
              resume(
                Effect.fail(
                  new WebSocketConnectionError({
                    url,
                    cause: new Error('Connection timeout'),
                  }),
                ),
              )
            }
          }, 30000)

          return Effect.sync(() => {
            clearTimeout(timeout)
            ws.close()
          })
        })

        // Create send function
        const send = (message: string | Buffer) =>
          Effect.try({
            try: () => {
              if (ws.readyState !== WebSocket.OPEN) {
                throw new WebSocketStateError({
                  message: 'WebSocket is not in OPEN state',
                  currentState: ws.readyState,
                  expectedState: 'OPEN',
                })
              }
              ws.send(message)
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

        // Create close function
        const close = (code?: number, reason?: string) =>
          Effect.sync(() => {
            ws.close(code, reason)
          })

        return {
          send,
          messages: Stream.fromQueue(messageQueue),
          state: Stream.fromQueue(stateQueue),
          close,
        } satisfies WebSocketConnection
      }).pipe(
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
