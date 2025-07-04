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

    // Skip low-value messages that don't warrant thread creation
    if (this.config.messageFiltering.enabled && this.shouldSkipMessage(message.content)) {
      console.log(`⚠️ Skipping low-value message from ${message.author.username}: "${message.content.slice(0, 50)}..."`)
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
   * Check if a message should be skipped based on simple filtering criteria
   */
  private shouldSkipMessage(content: string): boolean {
    const text = content.trim().toLowerCase()

    // Skip empty or very short messages
    if (text.length < this.config.messageFiltering.minMessageLength) {
      return true
    }

    // Skip simple greetings and reactions
    const simplePatterns = [
      /^(hi|hello|hey|wave to say hi)!?$/,
      /^(thanks?|thx|ty)!?$/,
      /^(welcome|good morning|good evening)!?$/,
      /^(lol|lmao|nice|cool|ok|yes|no|\+1)$/,
      /^[/!][a-z]+/, // Commands like /help, !ping
      /^https?:\/\/\S+$/, // URL-only messages
      /^\d+$/, // Number-only messages
    ]

    for (const pattern of simplePatterns) {
      if (pattern.test(text)) {
        return true
      }
    }

    // Skip emoji-heavy messages (1+ emojis, short text)
    const emojiCount = (content.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu) ?? []).length
    if (emojiCount >= 1 && content.length < 30) {
      return true
    }

    return false
  }

  /**
   * Create a thread for the given message
   */
  private async createThread(channelId: string, messageId: string, threadName: string): Promise<void> {
    const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/threads`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: getBotDiscordToken(this.config.discordToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: threadName,
        type: 11, // PUBLIC_THREAD
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Discord API error (${response.status}): ${errorText}`)
    }
  }
}
