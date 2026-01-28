# Lily Extension

Chrome side panel AI assistant powered by Claude Code CLI with local file persistence.

## Tech Stack
- **Extension:** Plasmo + React + TypeScript + Tailwind
- **Native Host:** Node.js (vanilla, no dependencies)
- **AI:** Claude Code CLI (`claude -p`)
- **Storage:** Local files in ~/lily/

## Architecture
Chrome Side Panel (Plasmo) <-> Native Messaging (request IDs) <-> ~/.lily-host/lily-host.js <-> Claude Code CLI <-> ~/lily/ (sessions/, state/, skills/, CLAUDE.md)

## Key Patterns
- Native Messaging: Always use request IDs, 4-byte LE length prefix, handle disconnects
- Tailwind theme colors: lily-bg #1a1a2e, lily-card #16213e, lily-accent #e94560, lily-hover #ff6b6b
- Functional React + hooks, TypeScript strict, async/await, error boundaries around native messaging

## Native Host Actions
| Action | Payload | Response |
|--------|---------|----------|
| ping | - | { ok, version, lilyDir, claudePath } |
| chat | { text } | { ok, response } |
| briefing | - | { ok, response } |
| log | { text } | { ok } |
| getState | { key } | { ok, data } |
| setState | { key, data } | { ok } |
| getGoals | - | { ok, data } |
| setGoals | { goals } | { ok } |

## Commands
- pnpm dev -- dev server with hot reload
- pnpm build -- production build
- Load unpacked from build/chrome-mv3-dev
