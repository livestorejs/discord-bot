import { Effect } from 'effect'
import { ClaudeCliService } from '../services/ClaudeCliService.js'
import { ConfigService } from '../services/ConfigService.js'
import { DiscordApiService } from '../services/DiscordApiService.js'
import type { DiscordInteraction } from '../services/DiscordGatewayService.js'
import { PermissionDeniedError } from '../services/InteractionHandlerService.js'
import { ApplicationCommandOptionType, type SlashCommand } from '../services/SlashCommandService.js'

/**
 * Helper to check if a user has admin permissions
 */
const checkAdminPermission = (userId: string) =>
  Effect.gen(function* () {
    const config = yield* ConfigService

    if (!config.config.adminUserIds.includes(userId)) {
      yield* new PermissionDeniedError({
        userId,
        commandName: 'docs',
        message: 'You do not have permission to use this command',
      })
    }
  })

/**
 * Helper to get thread context if the command is used in a thread
 */
const getThreadContext = (_channelId: string) => Effect.succeed(undefined) // For now, we'll just return undefined
// In the future, this could fetch recent messages from the thread

/**
 * The /docs slash command implementation
 */
export const DocsCommand: SlashCommand = {
  name: 'docs',
  description: 'Look up LiveStore documentation',
  options: [
    {
      name: 'query',
      type: ApplicationCommandOptionType.STRING,
      description: 'What would you like to know about LiveStore?',
      required: true,
    },
  ],

  execute: (interaction: DiscordInteraction) =>
    Effect.gen(function* () {
      const discordApi = yield* DiscordApiService
      const claudeCli = yield* ClaudeCliService

      // Extract the query from the interaction options
      const query = interaction.data.options?.find((o) => o.name === 'query')?.value

      if (typeof query !== 'string') {
        yield* discordApi.editInteractionResponse(
          interaction.application_id,
          interaction.token,
          'Error: No query provided',
        )
        return
      }

      // Check permissions
      yield* checkAdminPermission(interaction.user.id)

      // Get thread context if in thread
      const context = yield* getThreadContext(interaction.channel_id)

      // Execute Claude CLI
      const response = yield* claudeCli.executeQuery(query, context)

      // Send response
      yield* discordApi.editInteractionResponse(interaction.application_id, interaction.token, response)
    }).pipe(
      Effect.withSpan('command.docs', {
        attributes: {
          'span.label': `/docs: ${interaction.data.options?.find((o) => o.name === 'query')?.value}`,
          'discord.user.id': interaction.user.id,
          'discord.user.name': interaction.user.username,
          'discord.channel.id': interaction.channel_id,
        },
      }),
    ),
}
