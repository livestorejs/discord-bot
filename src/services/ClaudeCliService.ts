import { Command } from '@effect/platform'
import { Effect, Schema } from 'effect'

/**
 * Error for when Claude CLI execution fails
 */
export class ClaudeCliError extends Schema.TaggedError<ClaudeCliError>()('ClaudeCliError', {
  cause: Schema.Unknown,
  exitCode: Schema.Number,
  stderr: Schema.String,
  message: Schema.String,
}) {}

/**
 * Utility function to truncate strings for span attributes
 */
const truncateForSpan = (text: string | undefined, maxLength: number): string => {
  if (!text) return ''
  return text.length > maxLength ? `${text.substring(0, maxLength - 3)}...` : text
}

/**
 * Service for executing Claude CLI commands
 */
export class ClaudeCliService extends Effect.Service<ClaudeCliService>()('ClaudeCliService', {
  effect: Effect.gen(function* () {
    const executeQuery = (query: string, context?: string) =>
      Effect.gen(function* () {
        const prompt = context
          ? `Context: ${context}\n\nLook up LiveStore docs: ${query}`
          : `Look up LiveStore docs: ${query}`

        // Use Effect's Command module
        const result = yield* Command.make('claude', '--print', prompt).pipe(
          Command.string,
          Effect.timeout('30 seconds'),
          Effect.mapError((error) => {
            if (error && typeof error === 'object' && '_tag' in error && error._tag === 'TimeoutException') {
              return new ClaudeCliError({
                cause: error,
                exitCode: -1,
                stderr: 'Command timed out',
                message: 'Claude CLI execution timed out after 30 seconds',
              })
            }
            if (
              error &&
              typeof error === 'object' &&
              '_tag' in error &&
              (error._tag === 'BadArgument' || error._tag === 'SystemError')
            ) {
              return new ClaudeCliError({
                cause: error,
                exitCode: -1,
                stderr: String(error),
                message: 'Claude CLI execution failed',
              })
            }
            return new ClaudeCliError({
              cause: error,
              exitCode: -1,
              stderr: String(error),
              message: 'Claude CLI execution failed',
            })
          }),
        )

        // Format the response for Discord (handle potential length limits)
        return formatForDiscord(result)
      }).pipe(
        Effect.withSpan('claude-cli.execute', {
          attributes: {
            'span.label': `Claude: ${truncateForSpan(query, 50)}`,
            'claude.query': truncateForSpan(query, 100),
            'claude.context.length': context?.length ?? 0,
            'claude.context.preview': truncateForSpan(context, 200),
          },
        }),
      )

    const formatForDiscord = (content: string): string => {
      // Discord has a 2000 character limit for messages
      const MAX_LENGTH = 1900 // Leave some room for formatting

      if (content.length <= MAX_LENGTH) {
        return content
      }

      // Truncate and add a note
      const truncated = content.substring(0, MAX_LENGTH - 50)
      const lastNewline = truncated.lastIndexOf('\n')
      const cleanTruncated = lastNewline > 0 ? truncated.substring(0, lastNewline) : truncated

      return `${cleanTruncated}\n\n... (truncated due to Discord length limit)`
    }

    return { executeQuery } as const
  }),
}) {}
