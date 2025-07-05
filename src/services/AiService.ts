import * as Ai from '@effect/ai'
import * as AiOpenai from '@effect/ai-openai'
import { layer as FetchHttpClientLayer } from '@effect/platform/FetchHttpClient'
import { Config, Effect, Layer, Redacted, Schema } from 'effect'
import { ConfigService } from './ConfigService.js'

/**
 * Error that occurs when AI summarization fails
 */
export class AiSummarizationError extends Schema.TaggedError<AiSummarizationError>()('AiSummarizationError', {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

/**
 * Error that occurs when AI model configuration is invalid
 */
export class AiConfigurationError extends Schema.TaggedError<AiConfigurationError>()('AiConfigurationError', {
  message: Schema.String,
  missingConfig: Schema.String,
}) {}

/**
 * Error that occurs when AI API rate limits are exceeded
 */
export class AiRateLimitError extends Schema.TaggedError<AiRateLimitError>()('AiRateLimitError', {
  message: Schema.String,
  retryAfter: Schema.Number,
}) {}

/**
 * AI service for generating message summaries
 */
export class AiService extends Effect.Service<AiService>()('AiService', {
  effect: Effect.gen(function* () {
    const config = yield* ConfigService

    const summarizeMessage = (content: string): Effect.Effect<string, AiSummarizationError> =>
      Effect.gen(function* () {
        yield* Effect.log('🤖 Generating AI summary for message...')

        // TODO: Update @effect/ai-openai to include gpt-4.1-nano in type definitions
        const GPT_4_1_NANO = 'gpt-4.1-nano' as const
        const nanoModel = AiOpenai.OpenAiLanguageModel.model(GPT_4_1_NANO as any, {
          max_tokens: 16,
          temperature: 0.5,
        })

        const createTitleWithModel = (text: string) =>
          Effect.gen(function* () {
            // Avoid slicing in the middle of a word
            const safeText = text.length > 500 ? `${text.slice(0, 497)}...` : text
            const prompt = `Summarize the following Discord message in a clear, concise title (max 6 words):\n${safeText}`

            const response = yield* Ai.AiLanguageModel.generateText({ prompt }).pipe(
              Effect.withSpan('ai-generate-text', {
                attributes: {
                  'ai.model': GPT_4_1_NANO,
                  'ai.max_tokens': 16,
                  'ai.temperature': 0.5,
                  'ai.prompt_length': prompt.length,
                },
              }),
            )

            // Only trim whitespace and newlines
            return response.text.replace(/\n/g, '').trim()
          })

        const nanoModelProvider = yield* nanoModel

        return yield* nanoModelProvider.use(createTitleWithModel(content))
      }).pipe(
        Effect.withSpan('ai-summarize-message', {
          attributes: {
            'message.content_length': content.length,
          },
        }),
        Effect.provide(
          AiOpenai.OpenAiClient.layerConfig({
            apiKey: Config.succeed(Redacted.make(config.config.openaiKey)),
          }).pipe(Layer.provide(FetchHttpClientLayer)),
        ),
        Effect.catchAllCause((error) =>
          Effect.gen(function* () {
            yield* Effect.logWarning('⚠️ AI summarization failed, using fallback title:', error)
            return 'Discussion'
          }),
        ),
      )

    return { summarizeMessage } as const
  }),
  dependencies: [ConfigService.Default, FetchHttpClientLayer],
}) {}
