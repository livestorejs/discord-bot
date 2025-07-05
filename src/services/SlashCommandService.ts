import { Effect, Ref } from 'effect'
import { ConfigService } from './ConfigService.js'
import { DiscordApiService } from './DiscordApiService.js'
import type { DiscordInteraction } from './DiscordGatewayService.js'
import { CommandNotFoundError } from './InteractionHandlerService.js'

/**
 * Application command option types from Discord API
 */
export const ApplicationCommandOptionType = {
  SUB_COMMAND: 1,
  SUB_COMMAND_GROUP: 2,
  STRING: 3,
  INTEGER: 4,
  BOOLEAN: 5,
  USER: 6,
  CHANNEL: 7,
  ROLE: 8,
  MENTIONABLE: 9,
  NUMBER: 10,
  ATTACHMENT: 11,
} as const

/**
 * Interface for a slash command
 */
export interface SlashCommand {
  name: string
  description: string
  options?: Array<{
    type: number
    name: string
    description: string
    required?: boolean
  }>
  execute: (interaction: DiscordInteraction) => Effect.Effect<void, any, any>
}

/**
 * Service for managing slash commands
 */
export class SlashCommandService extends Effect.Service<SlashCommandService>()('SlashCommandService', {
  effect: Effect.gen(function* () {
    const config = yield* ConfigService
    const discordApi = yield* DiscordApiService

    // Command registry using Ref for dynamic updates
    const commandsRef = yield* Ref.make<Map<string, SlashCommand>>(new Map())

    const registerCommand = (command: SlashCommand) =>
      Effect.gen(function* () {
        // Update local registry
        yield* Ref.update(commandsRef, (map) => new Map(map).set(command.name, command))

        // Register with Discord API
        const applicationId = config.config.discordToken.split('.')[0]
        yield* discordApi.createGlobalCommand(applicationId, {
          name: command.name,
          description: command.description,
          options: command.options,
        })

        yield* Effect.log(`✅ Registered slash command: /${command.name}`)
      }).pipe(
        Effect.withSpan('slash-command.register', {
          attributes: {
            'span.label': `Register command: /${command.name}`,
            'discord.command.name': command.name,
            'discord.command.description': command.description,
          },
        }),
      )

    const getCommand = (name: string) =>
      Effect.gen(function* () {
        const commands = yield* Ref.get(commandsRef)
        const command = commands.get(name)

        if (!command) {
          yield* new CommandNotFoundError({
            commandName: name,
            message: `Command not found: /${name}`,
          })
        }

        return command!
      })

    const executeCommand = (interaction: DiscordInteraction) =>
      Effect.gen(function* () {
        const command = yield* getCommand(interaction.data.name)
        yield* command.execute(interaction)
      }).pipe(
        Effect.withSpan('slash-command.execute', {
          attributes: {
            'span.label': `Execute: /${interaction.data.name}`,
            'discord.command.name': interaction.data.name,
            'discord.user.id': interaction.user.id,
            'discord.user.name': interaction.user.username,
          },
        }),
      )

    const listCommands = () =>
      Effect.gen(function* () {
        const commands = yield* Ref.get(commandsRef)
        return Array.from(commands.values())
      })

    return { registerCommand, getCommand, executeCommand, listCommands } as const
  }),
  dependencies: [ConfigService.Default, DiscordApiService.Default],
}) {}
