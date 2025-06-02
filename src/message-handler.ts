import type * as Discord from 'discord-api-types/v10'
import type { AiService } from './ai-service.js'
import type { BotConfig } from './config.js'
import { getBotDiscordToken } from './config.js'

/**
 * Message handler for processing Discord messages
 */
export class MessageHandler {
  constructor(
    private readonly config: BotConfig,
    private readonly aiService: AiService,
  ) {}

  /**
   * Handle incoming Discord message
   */
  async handleMessage(message: Discord.APIMessage): Promise<void> {
    // Skip bot messages
    if (message.author.bot === true) return

    // Check if message is in allowed channels or is a reply to a message in allowed channels
    const isInAllowedChannel = this.config.channelIds.includes(message.channel_id)
    const isReplyToAllowedChannel =
      message.message_reference?.channel_id !== undefined &&
      this.config.channelIds.includes(message.message_reference.channel_id)

    if (!isInAllowedChannel && !isReplyToAllowedChannel) {
      return
    }

    try {
      console.log(`📝 Processing message from ${message.author.username} in channel ${message.channel_id}`)
      
      // Generate thread title using AI
      const title = await this.aiService.summarizeMessageAsync(message.content)
      console.log(`🤖 Generated title: "${title}"`)
      
      // Create thread
      await this.createThread(message.channel_id, message.id, title)
      console.log(`✅ Thread created successfully for message ${message.id}`)
      
    } catch (error) {
      console.error(`❌ Failed to process message ${message.id}:`, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  /**
   * Create a thread for the given message
   */
  private async createThread(channelId: string, messageId: string, title: string): Promise<void> {
    const botToken = getBotDiscordToken(this.config.discordToken)

    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/threads`, {
      method: 'POST',
      headers: {
        Authorization: botToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: title.slice(0, 90), // Discord thread name limit
        auto_archive_duration: 1440, // 24 hours
      } as Discord.RESTPostAPIChannelThreadsJSONBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Discord API error (${response.status}): ${errorText}`)
    }
  }
}
