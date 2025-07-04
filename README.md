# Discord ThreadBot

Automatically creates threads from Discord messages with AI-generated titles.

## How it Works

1. Bot monitors configured Discord channels
2. For each new message, sends content to OpenAI
3. Creates a thread with the AI-generated title
4. Maintains persistent connection with auto-reconnect

## Setup

### 1. Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create New Application → Bot
3. Enable **MESSAGE CONTENT** intent
4. Copy bot token
5. Generate invite URL with permissions:
   - Read Messages / View Channels
   - Send Messages
   - Create Public Threads
   - Read Message History

### 2. Configure Environment

```bash
# Install dependencies
pnpm install

# Create .envrc.local
export DISCORD_TOKEN="your_bot_token"
export OPENAI_KEY="sk-your_key"
```

### 3. Configure Channels

Edit `src/config.ts`:
```typescript
export const CHANNEL_IDS = [
  '1154415662874247191', // #general
  // Add your channel IDs
]
```

## Usage

**Start development:**
```bash
process-compose -U up -D
```

No need to re-start process-compose after changes. `bun --watch` will automatically restart the bot.

**Expected state**: Process-compose should always be running in daemon mode. If commands fail with socket errors, restart it.

**Start production:**
```bash
process-compose -f process-compose.prod.yaml -U up -D
```

**Commands:**
```bash
process-compose process list        # Check status
process-compose process restart bot # Restart
process-compose down                # Stop all
process-compose attach              # Interactive UI (humans)
tail -f logs/bot-dev.log            # View logs (real-time)
```

**Note**: Logs are written in real-time to both the terminal UI and log files using a `tee` workaround due to [process-compose issue #361](https://github.com/F1bonacc1/process-compose/issues/361).

## Security

- Restrict OpenAI key to `/v1/chat/completions` endpoint only
- Set monthly budget limit (e.g., $5)
- Bot only responds in configured channels