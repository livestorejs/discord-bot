import * as Ai from '@effect/ai'
import * as AiOpenai from '@effect/ai-openai'
import { layer as FetchHttpClientLayer } from '@effect/platform/FetchHttpClient'
import { Config, Effect, Layer, Redacted } from 'effect'
import type { BotConfig } from './config.js'
import { logger } from './logger.js'

/**
 * AI service for generating message summaries
 */
export class AiService {
  constructor(private readonly config: BotConfig) {}

  /**
   * Generate a concise title for a Discord message
   */
  readonly summarizeMessage = (content: string): Effect.Effect<string, unknown, never> =>
    Effect.gen(this, function* () {
      const nanoModel = AiOpenai.OpenAiLanguageModel.model('gpt-4.1-nano' as any, { max_tokens: 16, temperature: 0.5 })

      const createTitleWithModel = (text: string) =>
        Effect.gen(function* () {
          // Avoid slicing in the middle of a word
          const safeText = text.length > 500 ? `${text.slice(0, 497)}...` : text
          const prompt = `Summarize the following Discord message in a clear, concise title (max 6 words):\n${safeText}`

          const response = yield* Ai.AiLanguageModel.generateText({ prompt })

          // Only trim whitespace and newlines
          return response.text.replace(/\n/g, '').trim()
        })

      const nanoModelProvider = yield* nanoModel

      return yield* nanoModelProvider.use(createTitleWithModel(content))
    }).pipe(
      Effect.provide(
        AiOpenai.OpenAiClient.layerConfig({
          apiKey: Config.succeed(Redacted.make(this.config.openaiKey)),
        }).pipe(Layer.provide(FetchHttpClientLayer)),
      ),
      Effect.catchAllCause((error) => {
        logger.warn('⚠️ AI summarization failed, using fallback title:', error)
        return Effect.succeed('Discussion')
      }),
    )

  /**
   * Run the summarization and return a Promise
   */
  readonly summarizeMessageAsync = (content: string): Promise<string> => {
    logger.log('🤖 Generating AI summary for message...')
    return Effect.runPromise(this.summarizeMessage(content))
  }
}

/**
 * Create an AI service instance
 */
export const createAiService = (config: BotConfig): AiService => new AiService(config)
