# Discord Slash Commands Implementation Plan

Based on the current Effect-based architecture, here's the updated plan for implementing slash commands:

## Phase 1: Gateway Updates for Interactions

### 1.1 Update Gateway Intents
- Add `Guilds` intent to receive guild events (required for slash commands)
- Update `identify` function in `DiscordGatewayService.ts` to include:
  ```typescript
  intents: Discord.GatewayIntentBits.GuildMessages | 
           Discord.GatewayIntentBits.MessageContent | 
           Discord.GatewayIntentBits.Guilds
  ```

### 1.2 Handle INTERACTION_CREATE Events
- Add new event type `DiscordInteractionEvent` to gateway events
- Update gateway message handler to parse and emit interaction events
- Create Schema for Discord interaction payloads

## Phase 2: Create Interaction Infrastructure

### 2.1 InteractionHandlerService (New)
```typescript
export class InteractionHandlerService extends Effect.Service<InteractionHandlerService>()('InteractionHandlerService', {
  effect: Effect.gen(function* () {
    const discordApi = yield* DiscordApiService
    const commandRegistry = yield* SlashCommandService
    
    const handleInteraction = (interaction: DiscordInteraction) =>
      Effect.gen(function* () {
        // Acknowledge within 3 seconds
        yield* acknowledgeInteraction(interaction)
        
        // Route to command handler
        const command = yield* commandRegistry.getCommand(interaction.data.name)
        yield* command.execute(interaction)
      }).pipe(
        Effect.withSpan('interaction-handle', {
          attributes: {
            'span.label': `/${interaction.data.name} by ${interaction.user.username}`,
            'discord.command.name': interaction.data.name,
            'discord.user.name': interaction.user.username,
          }
        }),
        ErrorRecovery.withNetworkRetry
      )
    
    return { handleInteraction } as const
  }),
  dependencies: [DiscordApiService.Default, SlashCommandService.Default]
})
```

### 2.2 Extend DiscordApiService
Add new methods for interaction responses:
- `acknowledgeInteraction(interactionId, token)` - Initial ACK
- `sendDeferredResponse(interactionId, token)` - For long operations
- `editInteractionResponse(applicationId, token, content)` - Update response
- `createGlobalCommand(command)` - Register slash commands

## Phase 3: Implement Slash Command System

### 3.1 SlashCommandService (New)
```typescript
export class SlashCommandService extends Effect.Service<SlashCommandService>()('SlashCommandService', {
  effect: Effect.gen(function* () {
    const config = yield* ConfigService
    
    // Command registry using Ref for dynamic updates
    const commandsRef = yield* Ref.make<Map<string, SlashCommand>>(new Map())
    
    const registerCommand = (command: SlashCommand) =>
      Effect.gen(function* () {
        yield* Ref.update(commandsRef, map => new Map(map).set(command.name, command))
        // Register with Discord API
        yield* discordApi.createGlobalCommand(command.toDiscordFormat())
      })
    
    return { registerCommand, getCommand } as const
  })
})
```

### 3.2 Command Permission System
- Add `adminUserIds` to ConfigService configuration
- Create permission checking layer using Effect
- Support Discord's built-in permission system

## Phase 4: Implement /docs Command

### 4.1 ClaudeCliService (New)
```typescript
export class ClaudeCliService extends Effect.Service<ClaudeCliService>()('ClaudeCliService', {
  effect: Effect.gen(function* () {
    const executeQuery = (query: string, context?: string) =>
      Effect.gen(function* () {
        const command = context 
          ? `claude --print "Context: ${context}\n\nLook up LiveStore docs: ${query}"`
          : `claude --print "Look up LiveStore docs: ${query}"`
        
        // Use Effect's Command module
        const result = yield* Command.make("claude", "--print", prompt).pipe(
          Command.runExitCode,
          Effect.timeout("30 seconds"),
          Effect.mapError(error => new ClaudeCliError({ ... }))
        )
        
        return formatForDiscord(result.stdout)
      }).pipe(
        Effect.withSpan('claude-cli-execute', {
          attributes: {
            'span.label': `Claude: ${truncateForSpan(query, 50)}`,
            'claude.query': truncateForSpan(query, 100),
            'claude.context.length': context?.length ?? 0,
            'claude.context.preview': truncateForSpan(context, 200),
          }
        }),
        ErrorRecovery.withTimeout('30 seconds')
      )
    
    return { executeQuery } as const
  })
})
```

### 4.2 DocsCommand Implementation
```typescript
export const DocsCommand: SlashCommand = {
  name: 'docs',
  description: 'Look up LiveStore documentation',
  options: [{
    name: 'query',
    type: ApplicationCommandOptionType.String,
    description: 'What would you like to know about LiveStore?',
    required: true
  }],
  
  execute: (interaction) => Effect.gen(function* () {
    const query = interaction.data.options.find(o => o.name === 'query')?.value
    
    // Check permissions
    yield* checkAdminPermission(interaction.user.id)
    
    // Defer response for long operation
    yield* discordApi.sendDeferredResponse(interaction.id, interaction.token)
    
    // Get thread context if in thread
    const context = yield* getThreadContext(interaction.channel_id)
    
    // Execute Claude CLI
    const response = yield* claudeCli.executeQuery(query, context)
    
    // Send response
    yield* discordApi.editInteractionResponse(
      interaction.application_id,
      interaction.token,
      response
    )
  })
}
```

## Phase 5: Integration with Bot Service

### 5.1 Update DiscordBotService
- Subscribe to interaction events from gateway
- Route interactions to InteractionHandlerService
- Ensure proper error handling and recovery

### 5.2 Command Registration on Startup
- Add command registration to bot startup sequence
- Support both global and guild-specific commands
- Handle command updates/deletions

## Phase 6: Error Handling & Monitoring

### 6.1 Custom Error Types
- `InteractionTimeoutError` - Failed to respond within 3 seconds
- `CommandNotFoundError` - Unknown slash command
- `PermissionDeniedError` - User lacks permission
- `ClaudeCliError` - Claude CLI execution failed

### 6.2 Observability
- Add spans for all interaction handling
- Track command usage metrics
- Monitor Claude CLI performance
- Include truncated messages in span attributes for debugging
- Use `span.label` for human-readable span identification in Grafana:
  ```typescript
  Effect.withSpan('interaction.handle', {
    attributes: {
      'span.label': `/docs: ${truncateForSpan(query, 50)}`, // Human-readable label
      'discord.interaction.id': interaction.id,
      'discord.command.name': interaction.data.name,
      'discord.user.id': interaction.user.id,
      'discord.user.name': interaction.user.username,
      'discord.channel.id': interaction.channel_id,
      'command.query': truncateForSpan(query, 100), // Truncate to 100 chars
      'command.context': truncateForSpan(context, 200), // Truncate to 200 chars
    }
  })
  ```

## Implementation Order

1. **Gateway Updates** - Add intents and INTERACTION_CREATE handling
2. **API Extensions** - Add interaction endpoints to DiscordApiService  
3. **Core Services** - InteractionHandlerService & SlashCommandService
4. **Claude Integration** - ClaudeCliService
5. **First Command** - Implement /docs command
6. **Bot Integration** - Wire everything together
7. **Testing & Monitoring** - Add comprehensive tests and observability

## Key Considerations

- All services follow Effect patterns with proper error handling
- Use bounded queues for interaction processing to prevent overload
- Implement proper timeout handling for 3-second deadline
- Add circuit breakers for Claude CLI to prevent abuse
- Consider rate limiting per user/channel
- Support graceful degradation if Claude CLI is unavailable
- Add truncated content to span attributes for better debugging without exposing full sensitive data
- Use `span.label` attribute for human-readable span identification in Grafana traces

## Technical Details

### Utility Functions
```typescript
// Truncate strings for span attributes
const truncateForSpan = (text: string | undefined, maxLength: number): string => {
  if (!text) return ''
  return text.length > maxLength 
    ? text.substring(0, maxLength - 3) + '...' 
    : text
}

// Safe attribute extraction
const safeAttributes = (obj: any) => ({
  ...obj,
  // Truncate any string values over 500 chars
  ...Object.fromEntries(
    Object.entries(obj).map(([k, v]) => 
      typeof v === 'string' && v.length > 500 
        ? [k, truncateForSpan(v, 500)]
        : [k, v]
    )
  )
})

// Common span label patterns for consistency
const spanLabels = {
  interaction: (cmd: string, user: string) => `/${cmd} by ${user}`,
  claude: (query: string) => `Claude: ${truncateForSpan(query, 50)}`,
  api: (method: string, endpoint: string) => `${method} ${endpoint}`,
  error: (type: string, msg: string) => `Error: ${type} - ${truncateForSpan(msg, 40)}`,
}
```

### Interaction Schemas
```typescript
export const InteractionDataSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.Number,
  options: Schema.optional(Schema.Array(
    Schema.Struct({
      name: Schema.String,
      value: Schema.Union(Schema.String, Schema.Number, Schema.Boolean),
      type: Schema.Number
    })
  ))
})

export const InteractionSchema = Schema.Struct({
  id: Schema.String,
  application_id: Schema.String,
  type: Schema.Number,
  data: InteractionDataSchema,
  channel_id: Schema.String,
  token: Schema.String,
  user: Schema.Struct({
    id: Schema.String,
    username: Schema.String,
    discriminator: Schema.String
  })
})
```

### REST API Endpoints
```typescript
// Interaction Response
POST /interactions/{interaction.id}/{interaction.token}/callback

// Edit Original Response
PATCH /webhooks/{application.id}/{interaction.token}/messages/@original

// Create Global Command
POST /applications/{application.id}/commands

// Create Guild Command
POST /applications/{application.id}/guilds/{guild.id}/commands
```

### Command Registration Format
```typescript
interface ApplicationCommand {
  name: string
  description: string
  options?: ApplicationCommandOption[]
  default_permission?: boolean
  dm_permission?: boolean
}

interface ApplicationCommandOption {
  type: ApplicationCommandOptionType
  name: string
  description: string
  required?: boolean
  choices?: ApplicationCommandChoice[]
}
```

## Future Enhancements

- Additional commands (e.g., `/help`, `/status`, `/search`)
- Context menu commands (right-click actions)
- Autocomplete for command parameters
- User-installable app commands
- Message components (buttons, select menus)
- Modal dialogs for complex inputs