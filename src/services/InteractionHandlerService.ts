import { Effect, Schema } from 'effect'
import { DiscordApiService } from './DiscordApiService.js'
import type { DiscordInteraction } from './DiscordGatewayService.js'
import { SlashCommandService } from './SlashCommandService.js'

/**
 * Error for when an interaction fails to be acknowledged in time
 */
export class InteractionTimeoutError extends Schema.TaggedError<InteractionTimeoutError>()('InteractionTimeoutError', {
  interactionId: Schema.String,
  message: Schema.String,
}) {}

/**
 * Error for when a command is not found
 */
export class CommandNotFoundError extends Schema.TaggedError<CommandNotFoundError>()('CommandNotFoundError', {
  commandName: Schema.String,
  message: Schema.String,
}) {}

/**
 * Error for when a user lacks permission to use a command
 */
export class PermissionDeniedError extends Schema.TaggedError<PermissionDeniedError>()('PermissionDeniedError', {
  userId: Schema.String,
  commandName: Schema.String,
  message: Schema.String,
}) {}

/**
 * Service for handling Discord interactions (slash commands)
 */
export class InteractionHandlerService extends Effect.Service<InteractionHandlerService>()(
  'InteractionHandlerService',
  {
    effect: Effect.gen(function* () {
      const discordApi = yield* DiscordApiService
      const commandService = yield* SlashCommandService

      const handleInteraction = (interaction: DiscordInteraction) =>
        Effect.gen(function* () {
          // Acknowledge within 3 seconds
          yield* discordApi.acknowledgeInteraction(interaction.id, interaction.token).pipe(
            Effect.timeout('2.5 seconds'),
            Effect.mapError((error) => {
              if (error._tag === 'TimeoutException') {
                return new InteractionTimeoutError({
                  interactionId: interaction.id,
                  message: 'Failed to acknowledge interaction within 3 seconds',
                })
              }
              return error
            }),
          )

          // Execute the command
          yield* commandService.executeCommand(interaction)
        }).pipe(
          Effect.withSpan('interaction.handle', {
            attributes: {
              'span.label': `/${interaction.data.name} by ${interaction.user.username}`,
              'discord.command.name': interaction.data.name,
              'discord.user.id': interaction.user.id,
              'discord.user.name': interaction.user.username,
              'discord.interaction.id': interaction.id,
              'discord.channel.id': interaction.channel_id,
            },
          }),
        )

      return { handleInteraction } as const
    }),
    dependencies: [DiscordApiService.Default, SlashCommandService.Default],
  },
) {}
