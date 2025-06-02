# Discord ThreadBot

A Discord bot that automatically creates threaded conversations from messages in selected channels, using OpenAI to generate concise titles.

---

## 🏗 How it works

```
Discord Gateway  ──➔  Node.js/Bun Bot Process  ──➔  OpenAI API
      ▲                                       │
      │                                       └──➔  creates thread in same channel
      │ (WebSocket)                              with the title from the LLM
      │
   Reconnects automatically on disconnect
```

1. Bot connects to Discord Gateway via WebSocket
2. On each **MESSAGE_CREATE** event:
   1. Skip bot messages and non-target channels
   2. Send message content to OpenAI → get concise title
   3. Create thread using Discord API
3. Maintains persistent connection with automatic reconnection

---

## ⚙️ Setup & Deploy

### Prerequisites

- **Bun** (recommended) or Node.js 18+
- Discord bot token
- OpenAI API key

### Installation

```bash
# Clone and install dependencies
pnpm install


# Edit .envrc.local with your tokens
export DISCORD_TOKEN="your_discord_bot_token_here"
export OPENAI_KEY="sk-your_openai_api_key_here"
```

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create **New Application** → **Bot**
3. Enable **MESSAGE CONTENT** intent
4. Copy the bot token
5. Generate OAuth URL with scopes `bot` and permissions:
   - Read Messages / View Channels
   - Send Messages (and in Threads)
   - Create Public Threads
   - Read Message History
6. Invite the bot to your server

### Running

```bash
# Development (with auto-restart)
pnpm dev

# Production
pnpm start

# Build TypeScript
pnpm build
```

---

## 🔧 Configuration

Update channel IDs in `src/config.ts`:

```typescript
export const CHANNEL_IDS = [
  '1154415662874247191', // #general
  '1344991859805786142', // #contrib
  // Add your channel IDs here
] as const
```

---

## 🔐 Security & Limits

- OpenAI key should be **project-restricted** to `/v1/chat/completions`
- Set a monthly budget on your OpenAI project (e.g. $5)
- Bot only responds to messages in configured channels

---

## 🛠 Development

- Uses **Bun** for fast TypeScript execution
- Modern TypeScript with Effect for functional programming
- Modular architecture with separate services for:
  - Discord Gateway connection
  - Message handling
  - AI summarization
- Automatic reconnection and error handling
- Graceful shutdown on SIGINT/SIGTERM

---

## 🧪 Local Testing

1. **Setup Test Environment**
   ```bash
   # Create test Discord server
   # Add bot with required permissions
   # Update channel IDs in src/config.ts
   ```

2. **Run in Development Mode**
   ```bash
   pnpm dev
   ```

3. **Test the Bot**
   - Send messages in configured channels
   - Bot should create threads with AI-generated titles
   - Check console logs for detailed operation status

---

## 🗺 Roadmap / Ideas

- Slash command `/threadbot add #channel` for dynamic channel management
- Auto-archive duration based on channel type
- Detect code blocks and tag threads with language emoji
- Support for multiple Discord servers

## Historic notes

- The first version of this bot was targeting Cloudflare Workers but [Discord is blocking CF IPs](https://github.com/discord/discord-api-docs/issues/7146).

---

## 📄 License

MIT – see `LICENSE`.
