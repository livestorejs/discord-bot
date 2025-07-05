import { Layer } from 'effect'
import { vi } from 'vitest'
import { getBotDiscordToken, getRawDiscordToken } from './discord-utils.js'
import { ConfigService } from './services/ConfigService.js'
import type { DiscordMessage } from './services/DiscordGatewayService.js'

/**
 * Default mock configuration for tests
 */
export const mockConfig = {
  discordToken: 'test-token',
  openaiKey: 'test-openai-key',
  channelIds: ['channel-123', 'channel-456'],
  messageFiltering: {
    enabled: true,
    minMessageLength: 10,
  },
}

/**
 * Create a mock ConfigService layer for tests
 */
export const createMockConfigService = (overrides?: Partial<typeof mockConfig>) => {
  const config = { ...mockConfig, ...overrides }
  return Layer.succeed(ConfigService, {
    _tag: 'ConfigService',
    config,
    getRawDiscordToken: () => getRawDiscordToken(config.discordToken),
    getBotDiscordToken: () => getBotDiscordToken(config.discordToken),
  } as ConfigService)
}

/**
 * Create a mock Discord message for tests
 */
export const createMockMessage = (overrides: Partial<DiscordMessage> = {}): DiscordMessage => ({
  id: 'message-123',
  channel_id: 'channel-123',
  author: {
    id: 'user-123',
    username: 'testuser',
    discriminator: '0001',
    avatar: null,
    bot: false,
    global_name: null,
  },
  content: 'This is a test message that needs a thread',
  timestamp: '2024-01-01T00:00:00.000Z',
  edited_timestamp: null,
  tts: false,
  mention_everyone: false,
  mentions: [],
  mention_roles: [],
  attachments: [],
  embeds: [],
  pinned: false,
  type: 0,
  ...overrides,
})

/**
 * Setup test environment variables
 */
export const setupTestEnvironment = () => {
  const originalEnv = process.env

  const setup = () => {
    process.env = { ...originalEnv }
  }

  const cleanup = () => {
    process.env = originalEnv
  }

  return { setup, cleanup }
}

/**
 * Create a mock fetch function
 */
export const createMockFetch = () => {
  const mockFetch = vi.fn()
  const originalFetch = global.fetch

  const setup = () => {
    global.fetch = mockFetch as any
  }

  const cleanup = () => {
    global.fetch = originalFetch
  }

  return { mockFetch, setup, cleanup }
}
