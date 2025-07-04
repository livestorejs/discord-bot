import type * as Discord from 'discord-api-types/v10'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiService } from '../ai-service.js'
import type { BotConfig } from '../config.js'
import { MessageHandler } from '../message-handler.js'

// Simple mock AI service
class MockAiService extends AiService {
  constructor() {
    super({
      discordToken: 'test',
      openaiKey: 'test',
      channelIds: [],
      messageFiltering: { enabled: true, minMessageLength: 10 },
    })
  }

  readonly summarizeMessageAsync = vi.fn().mockResolvedValue('Test Thread Title')
}

// Test configuration
const testConfig: BotConfig = {
  discordToken: 'test-token',
  openaiKey: 'test-key',
  channelIds: ['123456789'],
  messageFiltering: {
    enabled: true,
    minMessageLength: 10,
  },
}

// Create mock Discord message
const createMessage = (content: string, overrides?: Partial<Discord.APIMessage>): Discord.APIMessage => ({
  id: 'test-message-id',
  channel_id: '123456789',
  author: {
    id: 'test-user-id',
    username: 'test-user',
    discriminator: '0001',
    global_name: null,
    avatar: null,
    bot: false,
  },
  content,
  timestamp: new Date().toISOString(),
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

describe('MessageHandler', () => {
  let messageHandler: MessageHandler
  let mockAiService: MockAiService
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockAiService = new MockAiService()
    messageHandler = new MessageHandler(testConfig, mockAiService)
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  describe('Basic filtering', () => {
    it('should skip bot messages', async () => {
      const botMessage = createMessage('Bot message', { author: { ...createMessage('').author, bot: true } })

      await messageHandler.handleMessage(botMessage)

      expect(mockAiService.summarizeMessageAsync).not.toHaveBeenCalled()
    })

    it('should skip messages from non-allowed channels', async () => {
      const message = createMessage('Test message', { channel_id: 'wrong-channel' })

      await messageHandler.handleMessage(message)

      expect(mockAiService.summarizeMessageAsync).not.toHaveBeenCalled()
    })

    it('should process meaningful messages', async () => {
      const message = createMessage('This is a meaningful discussion about programming')

      await messageHandler.handleMessage(message)

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('📝 Processing message'))
      expect(mockAiService.summarizeMessageAsync).toHaveBeenCalled()
    })
  })

  describe('Message filtering', () => {
    const testCases = [
      // Should be skipped
      { content: 'hi', shouldSkip: true, reason: 'too short' },
      { content: 'Wave to say hi!', shouldSkip: true, reason: 'greeting pattern' },
      { content: 'thanks', shouldSkip: true, reason: 'simple thanks' },
      { content: 'lol', shouldSkip: true, reason: 'simple reaction' },
      { content: '/help', shouldSkip: true, reason: 'command' },
      { content: 'https://example.com', shouldSkip: true, reason: 'URL only' },
      { content: '123', shouldSkip: true, reason: 'number only' },
      { content: '🎉🎊🥳', shouldSkip: true, reason: 'emoji heavy' },
      { content: '👍', shouldSkip: true, reason: 'single emoji' },

      // Should be processed
      { content: 'This is a meaningful discussion', shouldSkip: false, reason: 'meaningful content' },
      { content: 'Can someone help me with this problem?', shouldSkip: false, reason: 'help request' },
      { content: 'I found an interesting solution', shouldSkip: false, reason: 'informative' },
    ]

    testCases.forEach(({ content, shouldSkip, reason }) => {
      it(`should ${shouldSkip ? 'skip' : 'process'} "${content}" (${reason})`, async () => {
        const message = createMessage(content)

        await messageHandler.handleMessage(message)

        if (shouldSkip) {
          expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('⚠️ Skipping low-value message'))
          expect(mockAiService.summarizeMessageAsync).not.toHaveBeenCalled()
        } else {
          expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('📝 Processing message'))
          expect(mockAiService.summarizeMessageAsync).toHaveBeenCalled()
        }

        // Reset for next test
        vi.clearAllMocks()
        consoleLogSpy.mockClear()
      })
    })
  })

  describe('Configuration', () => {
    it('should respect disabled filtering', async () => {
      const configWithDisabledFiltering = { ...testConfig, messageFiltering: { enabled: false, minMessageLength: 10 } }
      const handler = new MessageHandler(configWithDisabledFiltering, mockAiService)

      const message = createMessage('hi') // Would normally be skipped

      await handler.handleMessage(message)

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('📝 Processing message'))
      expect(mockAiService.summarizeMessageAsync).toHaveBeenCalled()
    })
  })
})
