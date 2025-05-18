import * as Discord from 'discord-api-types/v10'
import { Effect, Layer, Config, Redacted } from 'effect'
import * as Ai from '@effect/ai'
import * as AiOpenai from '@effect/ai-openai'
import { layer as FetchHttpClientLayer } from '@effect/platform/FetchHttpClient'

export interface Env {
  DISCORD_TOKEN: string // bot token
  OPENAI_KEY: string
  // CHANNEL_IDS: string;          // comma-separated list
  BOT_GATEWAY: DurableObjectNamespace
}

const channelIds = [
  '1154415662874247191', // #general
  '1344991859805786142', // #contrib
  '1373597443798859776', // #internal/test-channel
]

/* -------------------------------------------------- *
 *  Edge worker: just health-check + cron "pings" the DO
 * -------------------------------------------------- */
export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => {
    const url = new URL(req.url)
    if (url.pathname === '/health') return new Response('ok')
    if (url.pathname === '/manual_init') {
      const id = env.BOT_GATEWAY.idFromName('global')
      ctx.waitUntil(env.BOT_GATEWAY.get(id).fetch('https://gw/init'))
      return new Response('Manual init triggered')
    }
    // Prevent automatic init on every fetch, use /manual_init or rely on scheduled pings
    return new Response('Worker is running. Use /manual_init to connect or wait for scheduled ping.')
  },

  scheduled: (_: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    const id = env.BOT_GATEWAY.idFromName('global')
    ctx.waitUntil(env.BOT_GATEWAY.get(id).fetch('https://gw/ping'))
  },
}

/* -------------------------------------------------- *
 *  Durable Object that owns the Discord WebSocket
 * -------------------------------------------------- */
export class BotGateway {
  private ws: WebSocket | null = null
  private seq: number | null = null
  private hb?: number

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(req: Request) {
    const path = new URL(req.url).pathname
    if (path === '/ping' && this.ws?.readyState === WebSocket.OPEN) return new Response('pong')
    if (path === '/init' && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
      await this.connect()
    }
    return new Response('ok')
  }

  /* ---------- gateway wiring ---------- */
  private async connect(): Promise<void> {
    try {
      const envToken = this.env.DISCORD_TOKEN.trim()
      const rawToken = envToken.startsWith('Bot ') ? envToken.slice(4) : envToken

      const gatewayResponse = await fetch('https://discord.com/api/v10/gateway/bot', {
        headers: { Authorization: `Bot ${rawToken}` },
      })

      if (gatewayResponse.status === 429) {
        const data = (await gatewayResponse.json()) as { retry_after: number; message?: string }
        const retryAfterSeconds = data.retry_after || 1
        await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000))
        return this.connect()
      }

      if (!gatewayResponse.ok) {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        return this.connect()
      }

      const { url: wssUrl } = (await gatewayResponse.json()) as { url: string }
      if (!wssUrl) {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        return this.connect()
      }

      const httpsUrlForHandshake = `${wssUrl.replace(/^wss:\/\//, 'https://')}?v=10&encoding=json`

      const wsUpgradeResponse = await fetch(httpsUrlForHandshake, {
        headers: {
          Upgrade: 'websocket',
          Authorization: `Bot ${rawToken}`,
        },
      })

      if (wsUpgradeResponse.status !== 101) {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        return this.connect()
      }

      const clientWs = wsUpgradeResponse.webSocket
      if (!clientWs) {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        return this.connect()
      }

      this.ws = clientWs
      this.ws.accept()

      const identifyPayload = {
        op: Discord.GatewayOpcodes.Identify,
        d: {
          token: rawToken,
          intents: Discord.GatewayIntentBits.GuildMessages | Discord.GatewayIntentBits.MessageContent,
          properties: { os: 'cf', browser: 'cf', device: 'cf' } satisfies Discord.GatewayIdentifyProperties,
        },
      }
      this.ws!.send(JSON.stringify(identifyPayload))

      this.ws.addEventListener('message', (e) => {
        const data = JSON.parse(e.data as string) as Discord.GatewayReceivePayload
        // console.debug('ws-msg', data)

        if (data.op === Discord.GatewayOpcodes.Dispatch) {
          // DISPATCH
          const dispatchData = data as Discord.GatewayDispatchPayload
          this.seq = dispatchData.s
          if (dispatchData.t === 'MESSAGE_CREATE') {
            this.state.waitUntil(this.onMessage(dispatchData.d))
          }
        } else {
          this.onPacket(data)
        }
      })

      this.ws.addEventListener('close', (event) => {
        this.ws = null
        if (this.hb) {
          clearInterval(this.hb)
          this.hb = undefined
        }
        if (event.code === 4004) {
          return // Authentication failed, do not reconnect
        }
        // For other close events, attempt to reconnect after a delay
        this.state.waitUntil(new Promise((resolve) => setTimeout(resolve, 5000)).then(() => this.connect()))
      })

      this.ws.addEventListener('error', (_event) => {
        console.error('Error in WebSocket:', _event)
        // Errors will typically be followed by a close event, which handles reconnects.
        // Additional error logging can be added here if needed.
      })
    } catch (error) {
      // console.error('Critical error during connect process:', error); // Keep one critical error log
      await new Promise((resolve) => setTimeout(resolve, 10000))
      return this.connect()
    }
  }

  private onPacket(pkt: Discord.GatewayReceivePayload) {
    switch (pkt.op) {
      case Discord.GatewayOpcodes.Hello: {
        // HELLO
        if (this.hb) clearInterval(this.hb)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const ivl = pkt.d.heartbeat_interval
        this.hb = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(
              JSON.stringify({ op: Discord.GatewayOpcodes.Heartbeat, d: this.seq === undefined ? null : this.seq }),
            )
          } else {
            if (this.hb) clearInterval(this.hb)
            this.hb = undefined
          }
        }, ivl) as any // Cast to any to satisfy Cloudflare Worker type for setInterval handle
        break
      }
      case Discord.GatewayOpcodes.HeartbeatAck: // Heartbeat ACK
        break
      case Discord.GatewayOpcodes.InvalidSession: // Invalid Session
        this.ws?.close(4000, 'Invalid session received in onPacket')
        break
      default:
        console.log(`onPacket received unhandled op code: ${pkt.op}`)
        break
    }
  }

  /* ---------- bot logic ---------- */
  private async onMessage(m: Discord.APIMessage) {
    console.debug('onMessage', m)
    // if (m.author.bot) return
    if (
      channelIds.includes(m.channel_id) === false &&
      (m.message_reference?.channel_id === undefined || !channelIds.includes(m.message_reference.channel_id))
    )
      return

    // Ensure rawToken is derived correctly for Authorization header here as well
    const envToken = this.env.DISCORD_TOKEN.trim()
    const rawTokenForAuth = envToken.startsWith('Bot ') ? envToken.slice(4) : envToken

    const title = await this.summarise(m.content)
    await fetch(`https://discord.com/api/v10/channels/${m.channel_id}/messages/${m.id}/threads`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${rawTokenForAuth}`, // Use Bot-prefixed token
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: title.slice(0, 90),
        auto_archive_duration: 1440,
      } as Discord.RESTPostAPIChannelThreadsJSONBody),
    })
  }

  private summarise = (content: string) =>
    Effect.gen(this, function* () {
      const nanoModel = AiOpenai.OpenAiLanguageModel.model('gpt-4.1-nano' as any, { max_tokens: 16, temperature: 0.7 })

      const createTitleWithModel = (text: string) =>
        Effect.gen(function* () {
          const prompt = `Title this Discord message in ≤ 6 words:\n"${text.slice(0, 500).replace(/["`]/g, "\\\\'")}"`

          const response = yield* Ai.AiLanguageModel.generateText({ prompt })

          return response.text.replace(/["'\\n]/g, '').trim()
        })

      const nanoModelProvider = yield* nanoModel

      return yield* nanoModelProvider.use(createTitleWithModel(content))
    }).pipe(
      Effect.provide(
        AiOpenai.OpenAiClient.layerConfig({
          apiKey: Config.succeed(Redacted.make(this.env.OPENAI_KEY)),
        }).pipe(Layer.provide(FetchHttpClientLayer)),
      ),
      Effect.catchAllCause((error) => {
        console.error('TMP: Error in summarise Effect:', error)
        return Effect.succeed('Discussion')
      }),
      Effect.runPromise,
    )
}
