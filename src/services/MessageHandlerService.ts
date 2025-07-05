import { Effect, Schema } from 'effect'
import { AiService } from './AiService.js'
import { ConfigService } from './ConfigService.js'
import { DiscordApiService } from './DiscordApiService.js'
import type { DiscordMessage } from './DiscordGatewayService.js'
import { ErrorRecovery } from './ErrorRecovery.js'

/**
 * Error that occurs during message processing
 */
export class MessageProcessingError extends Schema.TaggedError<MessageProcessingError>()('MessageProcessingError', {
  messageId: Schema.String,
  channelId: Schema.String,
  reason: Schema.String,
  cause: Schema.Unknown,
}) {}

/**
 * Check if a message should be skipped based on simple filtering criteria
 */
const shouldSkipMessage = Effect.fn('message-should-skip')(
  (content: string, minLength: number): Effect.Effect<boolean> =>
    Effect.sync(() => {
      const text = content.trim().toLowerCase()

      // Skip empty or very short messages
      if (text.length < minLength) {
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
    }),
)

/**
 * Message handler service for processing Discord messages
 */
export class MessageHandlerService extends Effect.Service<MessageHandlerService>()('MessageHandlerService', {
  effect: Effect.gen(function* () {
    const config = yield* ConfigService
    const aiService = yield* AiService
    const discordApi = yield* DiscordApiService

    const handleMessage = (message: DiscordMessage): Effect.Effect<void, MessageProcessingError> =>
      Effect.gen(function* () {
        // Skip bot messages
        if (message.author.bot === true) {
          return
        }

        // Check if message is in allowed channels or is a reply to a message in allowed channels
        const isInAllowedChannel = config.config.channelIds.includes(message.channel_id)
        const isReplyToAllowedChannel =
          message.message_reference?.channel_id !== undefined &&
          config.config.channelIds.includes(message.message_reference.channel_id)

        if (!isInAllowedChannel && !isReplyToAllowedChannel) {
          return
        }

        // Skip low-value messages that don't warrant thread creation
        if (config.config.messageFiltering.enabled) {
          const shouldSkip = yield* shouldSkipMessage(message.content, config.config.messageFiltering.minMessageLength)
          if (shouldSkip) {
            yield* Effect.log(
              `⚠️ Skipping low-value message from ${message.author.username}: "${message.content.slice(0, 50)}..."`,
            )
            return
          }
        }

        yield* Effect.log(`📝 Processing message from ${message.author.username} in channel ${message.channel_id}`)

        // Generate thread title using AI
        const title = yield* aiService.summarizeMessage(message.content).pipe(
          Effect.mapError(
            (error) =>
              new MessageProcessingError({
                messageId: message.id,
                channelId: message.channel_id,
                reason: 'Failed to generate thread title',
                cause: error,
              }),
          ),
        )
        yield* Effect.log(`🤖 Generated title: "${title}"`)

        // Create thread
        yield* discordApi.createThread(message.channel_id, message.id, title).pipe(
          Effect.mapError(
            (error) =>
              new MessageProcessingError({
                messageId: message.id,
                channelId: message.channel_id,
                reason: 'Failed to create thread',
                cause: error,
              }),
          ),
        )
        yield* Effect.log(`✅ Thread created successfully for message ${message.id}`)
      }).pipe(
        // Add retry logic for rate limit errors
        ErrorRecovery.withNetworkRetry,
        Effect.catchAll((error: MessageProcessingError) =>
          Effect.gen(function* () {
            // Log the error with context
            yield* Effect.logError(`❌ Failed to process message ${error.messageId}: ${error.reason}`, {
              messageId: error.messageId,
              channelId: error.channelId,
              reason: error.reason,
              cause: error.cause,
            })
            // Don't re-throw - we want to continue processing other messages
            // The bot should be resilient to individual message processing failures
          }),
        ),
        // This is a root span - each message gets its own trace
        Effect.withSpan('message.process', {
          root: true,
          attributes: {
            'span.label': `@${message.author.username}: "${message.content.slice(0, 50)}${message.content.length > 50 ? '...' : ''}"`,
            'discord.message.id': message.id,
            'discord.channel.id': message.channel_id,
            'discord.user.id': message.author.id,
            'discord.user.name': message.author.username,
            'message.length': message.content.length,
          },
        }),
      )

    return { handleMessage } as const
  }),
  dependencies: [ConfigService.Default, AiService.Default, DiscordApiService.Default],
}) {}
