import * as http from 'node:http'
import { Effect, Ref, Schema } from 'effect'

/**
 * Health status schema
 */
export const HealthStatus = Schema.Struct({
  status: Schema.Literal('healthy', 'unhealthy'),
  timestamp: Schema.String,
  components: Schema.Struct({
    gateway: Schema.Struct({
      connected: Schema.Boolean,
      lastHeartbeat: Schema.NullOr(Schema.String),
    }),
  }),
  uptime: Schema.Number,
})

export type HealthStatus = typeof HealthStatus.Type

/**
 * Global health state
 */
export const healthState = Ref.unsafeMake({
  startTime: Date.now(),
  gatewayConnected: false,
  lastHeartbeat: null as Date | null,
})

/**
 * Update gateway connection status
 */
export const updateGatewayStatus = (connected: boolean) =>
  Ref.update(healthState, (state) => ({
    ...state,
    gatewayConnected: connected,
    lastHeartbeat: connected ? new Date() : state.lastHeartbeat,
  }))

/**
 * Start health server using Node.js HTTP
 */
export const startHealthServer = () =>
  Effect.gen(function* () {
    const port = 8080

    yield* Effect.log(`🏥 Starting health endpoint on port ${port}`)

    const server = yield* Effect.try({
      try: () => {
        const server = http.createServer((req, res) => {
          // Handle CORS
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

          if (req.method === 'OPTIONS') {
            res.writeHead(200)
            res.end()
            return
          }

          if (req.url === '/api/health' && req.method === 'GET') {
            Effect.runPromise(
              Effect.gen(function* () {
                const state = yield* Ref.get(healthState)
                const now = Date.now()
                const uptime = Math.floor((now - state.startTime) / 1000)

                const status: HealthStatus = {
                  status: state.gatewayConnected ? 'healthy' : 'unhealthy',
                  timestamp: new Date().toISOString(),
                  components: {
                    gateway: {
                      connected: state.gatewayConnected,
                      lastHeartbeat: state.lastHeartbeat?.toISOString() ?? null,
                    },
                  },
                  uptime,
                }

                const statusCode = state.gatewayConnected ? 200 : 503
                res.writeHead(statusCode, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(status, null, 2))

                return yield* Effect.withSpan('health.check', {
                  attributes: {
                    'span.label': 'Health check',
                    'http.status_code': statusCode,
                  },
                })(Effect.succeed(undefined))
              }),
            ).catch((error) => {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Internal server error', details: String(error) }))
            })
          } else if (req.url === '/' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/plain' })
            res.end('Discord Bot Health Service')
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Not found' }))
          }
        })

        server.listen(port)
        return server
      },
      catch: (error) => new Error(`Failed to start health server: ${error}`),
    })

    return {
      shutdown: () =>
        Effect.sync(() => {
          server.close()
        }),
    }
  })
