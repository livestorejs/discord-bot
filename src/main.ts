import { DiscordBot } from './bot.js'
import { loadConfig } from './config.js'
import { logger } from './logger.js'

/**
 * Main application entry point
 */
const main = async (): Promise<void> => {
  try {
    logger.log('🚀 Starting Discord ThreadBot...')

    // Load configuration
    const config = loadConfig()
    logger.log('✅ Configuration loaded successfully')

    // Create and start the bot
    const bot = new DiscordBot(config)

    await bot.start()
    logger.log('🎉 Bot started and ready to process messages')

    // Keep the process alive
    setInterval(() => {
      if (!bot.running) {
        logger.error('❌ Bot is no longer running, exiting...')
        process.exit(1)
      }
    }, 60000) // Check every 60 seconds (reduced from 30s to avoid spam during reconnections)
  } catch (error) {
    logger.error('💥 Failed to start bot:', error)
    process.exit(1)
  }
}

// Start the application
main().catch((error) => {
  logger.error('💥 Critical error:', error)
  process.exit(1)
})
