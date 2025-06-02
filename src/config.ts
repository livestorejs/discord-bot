/**
 * Bot configuration interface
 */
export interface BotConfig {
  readonly discordToken: string
  readonly openaiKey: string
  readonly channelIds: readonly string[]
}

/**
 * Channel IDs where the bot should operate
 */
export const CHANNEL_IDS = [
  '1154415662874247191', // #general
  '1344991859805786142', // #contrib
  '1342877571393781830', // #ecosystem
  '1296109918968877076', // #random
  '1373597443798859776', // #internal/test-channel
] as const

/**
 * Load configuration from environment variables
 */
export const loadConfig = (): BotConfig => {
  const discordToken = process.env['DISCORD_TOKEN']
  const openaiKey = process.env['OPENAI_KEY']

  if (discordToken === undefined) {
    throw new Error('DISCORD_TOKEN environment variable is required')
  }

  if (openaiKey === undefined) {
    throw new Error('OPENAI_KEY environment variable is required')
  }

  return {
    discordToken: discordToken.trim(),
    openaiKey,
    channelIds: CHANNEL_IDS,
  } satisfies BotConfig
}

/**
 * Get the raw Discord token (without "Bot " prefix)
 */
export const getRawDiscordToken = (token: string): string => (token.startsWith('Bot ') ? token.slice(4) : token)

/**
 * Get the Discord token with "Bot " prefix for API calls
 */
export const getBotDiscordToken = (token: string): string => (token.startsWith('Bot ') ? token : `Bot ${token}`)
