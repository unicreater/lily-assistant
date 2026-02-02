# Parallel Search Integration

Free web search capability for Claude.

## Capabilities

- Web search queries
- Real-time information retrieval
- No API key or authentication required

## Prerequisites

- Claude Code CLI installed

## Setup

Run the setup script:
```bash
./setup.sh
```

The script will:
1. Verify Claude CLI is installed
2. Ask for scope (all projects or current only)
3. Register the MCP server

## Usage

After setup, simply ask Claude to search for information:
- "Search for the latest news about AI"
- "Find information about React 19 features"
- "Look up the weather in Tokyo"

## Troubleshooting

**"Claude CLI not found"**
Install Claude Code: `npm install -g @anthropic-ai/claude-code`

**Search not working**
Try removing and re-adding:
```bash
claude mcp remove parallel-search
./setup.sh
```
