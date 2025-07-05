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
pc-socket up
```

The bot runs in detached mode with auto-restart. No need to restart after code changes - `bun --watch` handles this automatically.

**Start production:**
```bash
process-compose -f process-compose.prod.yaml -U up -t=false &
```

**Commands:**
```bash
pc-socket status                    # Check status
pc-socket down                      # Stop all (with timeout handling)
pc-socket attach                    # Interactive UI (humans)  
process-compose process restart bot # Restart specific process
tail -f logs/bot-dev.log            # View logs (real-time)
```

**Process-compose script** (`pc-socket`):
- `up`: Start in detached socket mode with comprehensive cleanup
- `down`: Stop gracefully with timeout + force kill fallback  
- `status`: List running processes with timeout protection
- `attach`: Attach to interactive UI with socket validation

**Important for AI agents**: Always use `pc-socket up` to start process-compose. The script handles:
- Port cleanup (kills conflicting processes on port 8080)
- Socket file management
- Existing process-compose cleanup  
- Socket creation verification
- Proper error handling and timeouts

**Note**: Logs are written in real-time to both the terminal UI and log files using a `tee` workaround due to [process-compose issue #361](https://github.com/F1bonacc1/process-compose/issues/361).

## Security

- Restrict OpenAI key to `/v1/chat/completions` endpoint only
- Set monthly budget limit (e.g., $5)
- Bot only responds in configured channels

## Roadmap / Ideas

- Slash commands
  - `/docs`: Looks up the most recent message in the current thread in the LiveStore docs `docs.livestore.dev` and replies with a answer
  - `/autoname-thread`: Renames the current thread to the AI-generated title