import { Config, Effect, Schema } from 'effect'
import { getBotDiscordToken, getRawDiscordToken } from '../discord-utils.js'

/**
 * Message filtering configuration schema
 */
export const MessageFilteringSchema = Schema.Struct({
  enabled: Schema.Boolean,
  minMessageLength: Schema.Number.pipe(
    Schema.positive(),
    Schema.annotations({ description: 'Minimum message length to process' }),
  ),
})

/**
 * Bot configuration schema
 */
export const BotConfigSchema = Schema.Struct({
  discordToken: Schema.String.pipe(Schema.annotations({ description: 'Discord bot token' })),
  openaiKey: Schema.String.pipe(Schema.annotations({ description: 'OpenAI API key' })),
  channelIds: Schema.Array(Schema.String).pipe(
    Schema.annotations({ description: 'List of channel IDs where the bot operates' }),
  ),
  messageFiltering: MessageFilteringSchema,
})

/**
 * Type for the bot configuration
 */
export type BotConfig = typeof BotConfigSchema.Type

/**
 * Configuration error
 */
export class ConfigurationError extends Schema.TaggedError<ConfigurationError>()('ConfigurationError', {
  message: Schema.String,
}) {}

/**
 * Channel IDs where the bot should operate
 */
const CHANNEL_IDS = [
  '1154415662874247191', // #general
  '1344991859805786142', // #contrib
  '1342877571393781830', // #ecosystem
  '1296109918968877076', // #random
  '1373597443798859776', // #internal/test-channel
]

/**
 * Default message filtering configuration
 */
const DEFAULT_MESSAGE_FILTERING = {
  enabled: true,
  minMessageLength: 10,
}

/**
 * ConfigService provides configuration management
 */
export class ConfigService extends Effect.Service<ConfigService>()('ConfigService', {
  effect: Effect.gen(function* () {
    // Load configuration from environment
    const discordTokenStr = yield* Config.string('DISCORD_TOKEN').pipe(
      Effect.mapError(() => new ConfigurationError({ message: 'DISCORD_TOKEN environment variable is required' })),
    )

    const openaiKeyStr = yield* Config.string('OPENAI_KEY').pipe(
      Effect.mapError(() => new ConfigurationError({ message: 'OPENAI_KEY environment variable is required' })),
    )

    // Validate tokens are not empty
    if (discordTokenStr.trim() === '') {
      yield* new ConfigurationError({ message: 'DISCORD_TOKEN environment variable is required' })
    }

    if (openaiKeyStr.trim() === '') {
      yield* new ConfigurationError({ message: 'OPENAI_KEY environment variable is required' })
    }

    const config: BotConfig = {
      discordToken: discordTokenStr,
      openaiKey: openaiKeyStr,
      channelIds: CHANNEL_IDS,
      messageFiltering: DEFAULT_MESSAGE_FILTERING,
    }

    // Validate the entire config against the schema
    const validatedConfig = yield* Schema.decode(BotConfigSchema)(config).pipe(
      Effect.mapError((error) => new ConfigurationError({ message: `Invalid configuration: ${error}` })),
    )

    return {
      config: validatedConfig,
      getRawDiscordToken: () => getRawDiscordToken(validatedConfig.discordToken),
      getBotDiscordToken: () => getBotDiscordToken(validatedConfig.discordToken),
    } as const
  }),
  dependencies: [],
}) {}
