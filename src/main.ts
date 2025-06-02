import { DiscordBot } from './bot.js'
import { loadConfig } from './config.js'

/**
 * Main application entry point
 */
const main = async (): Promise<void> => {
  try {
    console.log('🚀 Starting Discord ThreadBot...')
    
    // Load configuration
    const config = loadConfig()
    console.log('✅ Configuration loaded successfully')
    
    // Create and start the bot
    const bot = new DiscordBot(config)
    
    await bot.start()
    console.log('🎉 Bot started and ready to process messages')
    
    // Keep the process alive
    setInterval(() => {
      if (!bot.running) {
        console.error('❌ Bot is no longer running, exiting...')
        process.exit(1)
      }
    }, 30000) // Check every 30 seconds
    
  } catch (error) {
    console.error('💥 Failed to start bot:', error)
    process.exit(1)
  }
}

// Start the application
main().catch((error) => {
  console.error('💥 Critical error:', error)
  process.exit(1)
})
