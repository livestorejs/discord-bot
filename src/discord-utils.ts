/**
 * Discord-related utility functions
 */

/**
 * Get the raw Discord token without the "Bot " prefix
 */
export const getRawDiscordToken = (token: string): string => {
  return token.startsWith('Bot ') ? token.slice(4) : token
}

/**
 * Ensure the Discord token has the "Bot " prefix
 */
export const getBotDiscordToken = (token: string): string => {
  return token.startsWith('Bot ') ? token : `Bot ${token}`
}

/**
 * Common Discord API constants
 */
export const DISCORD_API_BASE_URL = 'https://discord.com/api/v10'
export const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json'
