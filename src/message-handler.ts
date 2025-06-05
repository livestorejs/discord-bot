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
      // Check if this is a Discord API error we can parse
      if (error instanceof Error && error.message.includes('Discord API error')) {
        // This will include our gracefully handled cases and actual API errors
        console.error(`❌ Failed to process message ${message.id}: ${error.message}`)
      } else {
        // This covers other types of errors (AI service, network, etc.)
        console.error(
          `❌ Failed to process message ${message.id}:`,
          error instanceof Error ? error.message : 'Unknown error',
        )
      }
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

      try {
        const errorData = JSON.parse(errorText) as { code?: number; message?: string }

        // Handle specific Discord API error codes
        switch (errorData.code) {
          case 50068: // Invalid message type
            console.log(
              `⚠️ TMP Skipping message ${messageId}: Cannot create thread from this message type (${errorData.message})`,
            )
            return

          case 160004: // A thread has already been created for this message
            console.log(`⚠️ TMP Skipping message ${messageId}: Thread already exists for this message`)
            return

          case 50013: // Missing Permissions
            console.log(`⚠️ TMP Skipping message ${messageId}: Bot lacks permissions to create threads in this channel`)
            return

          case 160006: // Maximum number of active threads reached
            console.log(`⚠️ TMP Skipping message ${messageId}: Channel has reached maximum active threads limit`)
            return

          case 50024: // Cannot execute action on this channel type
            console.log(`⚠️ TMP Skipping message ${messageId}: Cannot create threads in this channel type`)
            return

          case 40067: // A tag is required to create a forum post in this channel
            console.log(`⚠️ TMP Skipping message ${messageId}: Tags required for forum posts (${errorData.message})`)
            return

          default:
            // For other errors, throw to maintain existing behavior
            throw new Error(`Discord API error (${response.status}): ${errorText}`)
        }
      } catch (parseError) {
        // If we can't parse the error response, throw the original error
        throw new Error(`Discord API error (${response.status}): ${errorText}`)
      }
    }
  }
}
