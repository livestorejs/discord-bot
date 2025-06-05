import * as Discord from 'discord-api-types/v10'
import WebSocket from 'ws'
import type { BotConfig } from './config.js'
import { getRawDiscordToken } from './config.js'

/**
 * Discord Gateway connection manager
 */
export class DiscordGateway {
  private ws: WebSocket | undefined = undefined
  private seq: number | undefined = undefined
  private heartbeatInterval: NodeJS.Timeout | undefined = undefined
  private reconnectTimeout: NodeJS.Timeout | undefined = undefined
  private isConnecting = false

  constructor(
    private readonly config: BotConfig,
    private readonly onMessage: (message: Discord.APIMessage) => Promise<void>,
  ) {}

  /**
   * Start the gateway connection
   */
  async start(): Promise<void> {
    if (this.isConnecting || (this.ws !== undefined && this.ws.readyState === WebSocket.OPEN)) {
      return
    }

    console.log('🔗 Connecting to Discord Gateway...')
    await this.connect()
  }

  /**
   * Stop the gateway connection
   */
  stop(): void {
    console.log('🔌 Disconnecting from Discord Gateway...')

    if (this.heartbeatInterval !== undefined) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = undefined
    }

    if (this.reconnectTimeout !== undefined) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = undefined
    }

    if (this.ws !== undefined) {
      this.ws.close(1000, 'Bot shutting down')
      this.ws = undefined
    }

    this.isConnecting = false
  }

  /**
   * Check if the gateway is connected
   */
  get isConnected(): boolean {
    return this.ws !== undefined && this.ws.readyState === WebSocket.OPEN
  }

  /**
   * Connect to Discord Gateway
   */
  private async connect(): Promise<void> {
    if (this.isConnecting) return

    this.isConnecting = true

    try {
      const rawToken = getRawDiscordToken(this.config.discordToken)

      // Get gateway URL
      const gatewayResponse = await fetch('https://discord.com/api/v10/gateway/bot', {
        headers: { Authorization: `Bot ${rawToken}` },
      })

      if (gatewayResponse.status === 429) {
        const data = (await gatewayResponse.json()) as { retry_after: number; message?: string }
        const retryAfterSeconds = data.retry_after || 1
        console.warn(`⏳ Rate limited by Discord API, retrying in ${retryAfterSeconds}s...`)
        await this.delay(retryAfterSeconds * 1000)
        this.isConnecting = false
        return this.connect()
      }

      if (!gatewayResponse.ok) {
        console.error(`❌ Failed to get Discord Gateway URL: ${gatewayResponse.status}`)
        await this.delay(5000)
        this.isConnecting = false
        return this.connect()
      }

      const { url: wssUrl } = (await gatewayResponse.json()) as { url: string }
      if (wssUrl === undefined) {
        console.error('❌ No WebSocket URL received from Discord')
        await this.delay(5000)
        this.isConnecting = false
        return this.connect()
      }

      // Create WebSocket connection
      const wsUrl = `${wssUrl}?v=10&encoding=json`
      this.ws = new WebSocket(wsUrl)

      this.ws.on('open', () => {
        console.log('✅ Connected to Discord Gateway')
        this.isConnecting = false
        this.identify()
      })

      this.ws.on('message', (data) => {
        const payload = JSON.parse(data.toString()) as Discord.GatewayReceivePayload
        this.handleMessage(payload)
      })

      this.ws.on('close', (code) => {
        console.warn(`🔌 Discord Gateway connection closed (code: ${code})`)
        this.cleanup()

        if (code === 4004) {
          console.error('❌ Authentication failed - invalid Discord token')
          return
        }

        console.log('🔄 Scheduling reconnection to Discord Gateway...')
        this.scheduleReconnect()
      })

      this.ws.on('error', (error) => {
        console.error('❌ Discord Gateway WebSocket error:', error.message)
      })
    } catch (error) {
      console.error(
        '❌ Failed to connect to Discord Gateway:',
        error instanceof Error ? error.message : 'Unknown error',
      )
      this.isConnecting = false
      await this.delay(10000)
      return this.connect()
    }
  }

  /**
   * Send identify payload to Discord
   */
  private identify(): void {
    if (this.ws === undefined || this.ws.readyState !== WebSocket.OPEN) return

    console.log('🔐 Identifying with Discord...')

    const rawToken = getRawDiscordToken(this.config.discordToken)
    const identifyPayload = {
      op: Discord.GatewayOpcodes.Identify,
      d: {
        token: rawToken,
        intents: Discord.GatewayIntentBits.GuildMessages | Discord.GatewayIntentBits.MessageContent,
        properties: {
          os: 'linux',
          browser: 'discord-bot',
          device: 'discord-bot',
        } satisfies Discord.GatewayIdentifyProperties,
      },
    }

    this.ws.send(JSON.stringify(identifyPayload))
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(payload: Discord.GatewayReceivePayload): void {
    if (payload.op === Discord.GatewayOpcodes.Dispatch) {
      const dispatchData = payload as Discord.GatewayDispatchPayload
      this.seq = dispatchData.s

      if (dispatchData.t === 'READY') {
        console.log('🎯 Discord bot is ready and listening for messages')
      } else if (dispatchData.t === 'MESSAGE_CREATE') {
        // Handle message asynchronously without blocking
        this.onMessage(dispatchData.d).catch((error) => {
          console.error('❌ Error handling message:', error instanceof Error ? error.message : 'Unknown error')
        })
      }
    } else {
      this.handleOpcode(payload)
    }
  }

  /**
   * Handle non-dispatch opcodes
   */
  private handleOpcode(payload: Discord.GatewayReceivePayload): void {
    switch (payload.op) {
      case Discord.GatewayOpcodes.Hello: {
        if (this.heartbeatInterval !== undefined) {
          clearInterval(this.heartbeatInterval)
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const interval = payload.d.heartbeat_interval as number
        console.log(`💓 Starting heartbeat every ${interval}ms`)
        this.heartbeatInterval = setInterval(() => {
          this.sendHeartbeat()
        }, interval)
        break
      }

      case Discord.GatewayOpcodes.HeartbeatAck:
        // Heartbeat acknowledged - no need to log this frequently
        break

      case Discord.GatewayOpcodes.Reconnect: {
        console.log('🔄 TMP Discord requested reconnect, closing connection to reconnect...')
        // Discord is asking us to reconnect - this is normal
        this.ws?.close(1000, 'Reconnect requested by Discord')
        break
      }

      case Discord.GatewayOpcodes.InvalidSession:
        console.error('❌ Invalid session received from Discord')
        this.ws?.close(4000, 'Invalid session received')
        break

      default:
        // Only log opcodes we might care about, but don't log common ones like Heartbeat
        if (payload.op !== Discord.GatewayOpcodes.Heartbeat) {
          console.log(`🔍 TMP Received unhandled opcode: ${payload.op}`)
        }
        break
    }
  }

  /**
   * Send heartbeat to Discord
   */
  private sendHeartbeat(): void {
    if (this.ws === undefined || this.ws.readyState !== WebSocket.OPEN) {
      if (this.heartbeatInterval !== undefined) {
        clearInterval(this.heartbeatInterval)
        this.heartbeatInterval = undefined
      }
      return
    }

    const heartbeatPayload = {
      op: Discord.GatewayOpcodes.Heartbeat,
      d: this.seq ?? null,
    }

    this.ws.send(JSON.stringify(heartbeatPayload))
  }

  /**
   * Clean up connection state
   */
  private cleanup(): void {
    if (this.heartbeatInterval !== undefined) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = undefined
    }

    this.ws = undefined
    this.isConnecting = false
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout !== undefined) {
      clearTimeout(this.reconnectTimeout)
    }

    this.reconnectTimeout = setTimeout(() => {
      console.log('🔄 Attempting to reconnect to Discord Gateway...')
      this.connect()
    }, 5000)
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
