import { type AiService, createAiService } from './ai-service.js'
import type { BotConfig } from './config.js'
import { DiscordGateway } from './discord-gateway.js'
import { MessageHandler } from './message-handler.js'

/**
 * Main Discord bot class
 */
export class DiscordBot {
  private readonly aiService: AiService
  private readonly messageHandler: MessageHandler
  private readonly gateway: DiscordGateway
  private isRunning = false
  private connectionLostTime: number | undefined = undefined
  private readonly maxReconnectionTime = 5 * 60 * 1000 // 5 minutes

  constructor(private readonly config: BotConfig) {
    this.aiService = createAiService(this.config)
    this.messageHandler = new MessageHandler(this.config, this.aiService)
    this.gateway = new DiscordGateway(this.config, (message) => this.messageHandler.handleMessage(message))
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return
    }

    this.isRunning = true
    console.log('🔧 Initializing bot services...')

    // Set up graceful shutdown
    this.setupGracefulShutdown()

    // Start the Discord gateway connection
    await this.gateway.start()
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return
    }

    console.log('🛑 Stopping bot...')
    this.isRunning = false
    this.gateway.stop()
    console.log('✅ Bot stopped successfully')
  }

  /**
   * Check if the bot is running
   * Allow temporary disconnections during reconnection attempts
   */
  get running(): boolean {
    if (!this.isRunning) {
      return false
    }

    // If we're connected, clear any disconnection tracking
    if (this.gateway.isConnected) {
      this.connectionLostTime = undefined
      return true
    }

    // If we just disconnected, start tracking the time
    if (this.connectionLostTime === undefined) {
      this.connectionLostTime = Date.now()
      console.log('⚠️ TMP Gateway disconnected, allowing time for reconnection...')
      return true // Still consider it running for now
    }

    // If we've been disconnected for too long, consider it not running
    const disconnectedFor = Date.now() - this.connectionLostTime
    if (disconnectedFor > this.maxReconnectionTime) {
      console.error(
        `❌ Gateway has been disconnected for ${Math.round(disconnectedFor / 1000)}s, considering bot not running`,
      )
      return false
    }

    // Still within acceptable reconnection time
    return true
  }

  /**
   * Set up graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      console.log(`🔔 Received ${signal}, shutting down gracefully...`)
      await this.stop()
      process.exit(0)
    }

    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGHUP', () => shutdown('SIGHUP'))
  }
}
