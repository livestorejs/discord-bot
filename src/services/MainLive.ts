import { layer as FetchHttpClientLayer } from '@effect/platform/FetchHttpClient'
import { Layer } from 'effect'
import { AiService } from './AiService.js'
import { ConfigService } from './ConfigService.js'
import { DiscordApiService } from './DiscordApiService.js'
import { DiscordBotService } from './DiscordBotService.js'
import { DiscordGatewayService } from './DiscordGatewayService.js'
import { MessageHandlerService } from './MessageHandlerService.js'
import { WebSocketService } from './WebSocketService.js'

/**
 * Main layer that provides all services for the Discord bot
 */
export const MainLive = DiscordBotService.Default.pipe(
  // Discord Bot depends on Gateway and MessageHandler
  Layer.provide(DiscordGatewayService.Default),
  Layer.provide(MessageHandlerService.Default),
  // Gateway depends on WebSocket and Config
  Layer.provide(WebSocketService.Default),
  // MessageHandler depends on Config, AI, and Discord API
  Layer.provide(AiService.Default),
  Layer.provide(DiscordApiService.Default),
  // Everything depends on Config
  Layer.provide(ConfigService.Default),
  // AI Service needs HTTP client
  Layer.provide(FetchHttpClientLayer),
)
