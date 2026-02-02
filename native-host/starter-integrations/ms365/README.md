# Microsoft 365 Integration

Access Outlook, Calendar, OneDrive, and Teams through Claude.

## Capabilities

- **Mail**: Read, send, search emails
- **Calendar**: View, create events
- **Files**: Access OneDrive files
- **Teams**: Read messages (if enabled)

## Prerequisites

- Claude Code CLI installed
- Node.js/npx installed
- Microsoft 365 account (work, school, or personal)

## Setup

Run the setup script:
```bash
./setup.sh
```

The script will:
1. Verify dependencies are installed
2. Ask for scope (all projects or current only)
3. Ask for account type (work/school/personal)
4. Ask which tools to enable
5. Register the MCP server

## Authentication

When you first ask Claude to use MS365 features, you'll be prompted with:
1. A URL: `https://microsoft.com/devicelogin`
2. A code to enter

Visit the URL, enter the code, and sign in with your Microsoft account.

## Usage

After setup, ask Claude to:
- "Show my recent emails"
- "What meetings do I have today?"
- "Send an email to john@example.com about the project update"
- "Find files in OneDrive about Q4 report"

## Troubleshooting

**"npx not found"**
Install Node.js: https://nodejs.org

**"Claude CLI not found"**
Install Claude Code: `npm install -g @anthropic-ai/claude-code`

**Authentication expired**
The device code flow will automatically re-prompt when needed.

**Wrong account**
Remove and re-setup:
```bash
claude mcp remove ms365
./setup.sh
```
