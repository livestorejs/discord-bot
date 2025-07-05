# Observability Design

http://dev2.tail8108.ts.net:3001/a/grafana-exploretraces-app/explore

## Philosophy

Each trace represents a complete, bounded operation that finishes within ~1 minute. No long-lived traces spanning hours or days. Every trace tells a story with a clear beginning and end.

## Root Traces

### `message.process`
When a user sends a message in Discord, we process it to create a thread with an AI-generated title.
- **Duration**: 1-10 seconds
- **Key operations**: Message validation → AI summarization → Thread creation

### `gateway.reconnect` 
When the WebSocket connection to Discord drops, we attempt to reconnect with exponential backoff.
- **Duration**: 1-60 seconds  
- **Key operations**: Disconnect → Wait backoff → Connect → Authenticate

### `gateway.heartbeat_cycle`
Discord requires periodic heartbeats to maintain the connection. Each cycle is its own trace.
- **Duration**: ~41 seconds
- **Key operations**: Send heartbeat → Receive acknowledgment
- **Note**: Links to previous cycle for continuity

### `bot.startup`
When the bot starts up, it loads configuration and establishes the initial Discord connection.
- **Duration**: 1-10 seconds
- **Key operations**: Load config → Connect to gateway → Wait for ready signal

## Design Principles

1. **Bounded operations** - Every trace completes within a reasonable time
2. **Semantic clarity** - Each trace represents one logical user action or system operation  
3. **No accumulation** - Traces are exported immediately, preventing memory buildup
4. **Actionable insights** - Traces help diagnose real problems, not just record events

## Implementation

- Each root trace starts fresh - no parent span context
- Child spans use `Effect.withSpan` to maintain trace hierarchy
- Related traces link to each other (e.g., sequential heartbeat cycles)
- High-frequency operations may be sampled to reduce volume
- `span.label` attribute provides human-readable context in Grafana UI