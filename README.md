# discord-bot

# LiveStore ThreadBot

Small Cloudflare Worker that turns every message in selected Discord channels
into its own threaded conversation, using GPT‑4.1 nano to invent a concise
1‑line title.

---

## ✨ Why

- **Zero servers** – the Gateway WebSocket lives in a Durable Object; Cloudflare
  bills only when the Worker is executing.
- **Cheap AI** – ≤ \$0.10 / million input tokens with GPT‑4.1 nano (< \$0.00001
  per message).
- **Clutter‑free channels** – threads keep #support or #ideas readable without
  relying on forum channels.

---

## 🏗 How it works

```
Discord Gateway  ──➔  Durable Object (BotGateway)  ──➔  OpenAI
      ▲                                         │
      │                                         └──➔  creates thread in same channel
      │ (WebSocket)                               with the title from the LLM
Cloudflare cron ──➔ keeps the WebSocket warm
```

1. Worker fetches the Gateway URL and opens a WebSocket from inside the DO.
2. On each **MESSAGE\_CREATE** event:

   1. Skip bots + non‑target channels.
   2. Send a 50‑token prompt to OpenAI → get ≈6‑word title.
   3. `POST /threads` to Discord to start the thread.
3. A 15‑minute cron ping prevents the DO from idling out.

---

## ⚙️ Deploy

```bash
wrangler deploy
```

### Discord setup (once)

1. Dev Portal → **New Application** → **Bot**.
2. Enable **MESSAGE CONTENT** intent.
3. Copy the token.
4. OAuth URL with scopes `bot` + permissions:

   - Read Messages / View Channels
   - Send Messages (and in Threads)
   - Create Public Threads
   - Read Message History
5. Invite the bot to your server.

---

## 🔐 Security & limits

- OpenAI key is **project‑restricted** to `/v1/chat/completions` +
  **gpt‑4.1‑nano** only.
- Put a hard monthly budget on that project (e.g. \$5).
- The DO keeps a 3 MB in‑memory LRU to rate‑limit abuse (default 15 msgs/15 s).

---

## 🛠 Development

- `wrangler dev --remote` streams logs in real time.
- Use `?guild_id=...` in the Gateway Identify payload if you want to test in a
  staging guild only.

---

## 🧪 Local Testing

1. **Setup Environment**
   ```bash
   # Copy the example env file
   cp .dev.vars.example .dev.vars

   # Add your Discord bot token and OpenAI key
   DISCORD_TOKEN=your_bot_token
   OPENAI_KEY=your_openai_key
   ```

2. **Discord Setup**
   - Create a new Discord server for testing
   - Create a new bot in the
     [Discord Developer Portal](https://discord.com/developers/applications)
   - Enable the **MESSAGE CONTENT** intent
   - Add the bot to your test server with the required permissions
   - Update the `channelIds` array in `src/worker.ts` with your test channel IDs

3. **Run Locally**
   ```bash
   # Start the worker in dev mode
   wrangler dev --remote
   ```

4. **Test the Bot**
   - Send a message in one of the configured channels
   - The bot should create a thread with an AI-generated title
   - Check the worker logs for any errors

5. **Testing Cron Jobs** Since Miniflare doesn't automatically trigger scheduled
   workers, you can test them in two ways:

   ```bash
   # Option 1: Trigger the scheduled event manually via the special endpoint
   curl http://localhost:8787/__scheduled

   # Option 2: Use the test-scheduled flag when starting the dev server
   wrangler dev --remote --test-scheduled
   ```

   You can also test the WebSocket keep-alive functionality directly by making a
   GET request to the ping endpoint:
   ```bash
   curl http://localhost:8787/ping
   ```

---

## 🗺 Roadmap / ideas

- Slash command `/threadbot add #channel` → dynamic channel list (needs
  Interactions endpoint).
- Auto‑archive duration based on channel type.
- Detect code blocks and tag threads with language emoji.

---

## 📄 License

MIT – see `LICENSE`.
