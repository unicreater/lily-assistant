# Google Workspace Integration

Access Gmail, Calendar, Drive, Docs, Sheets, and Slides through Claude.

## Capabilities

- **Gmail**: Read, send, search emails
- **Calendar**: View, create, manage events
- **Drive**: Access and search files
- **Docs**: Read and create documents
- **Sheets**: Read and edit spreadsheets
- **Slides**: Access presentations

## Prerequisites

- Claude Code CLI installed
- Google account

## Setup

Run the setup script:
```bash
./setup.sh
```

The script will:
1. Install `uv` if needed (for running workspace-mcp)
2. Verify Claude CLI is installed
3. Ask for scope (all projects or current only)
4. Register the MCP server with shared OAuth credentials

**No OAuth setup required!** Lily includes shared credentials so you can get started immediately.

### Using Your Own Credentials (Optional)

If you prefer to use your own OAuth credentials:
```bash
export GOOGLE_OAUTH_CLIENT_ID="your-client-id"
export GOOGLE_OAUTH_CLIENT_SECRET="your-secret"
./setup.sh
```

To create your own credentials:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable APIs: Gmail, Calendar, Drive, Docs, Sheets, Slides
4. Go to "Credentials" → "Create OAuth Client ID"
5. Choose "Desktop app"
6. Download the credentials

## Authentication

After setup, the first time you ask Claude to access Google services:
1. A browser window opens
2. Sign in with your Google account
3. Grant the requested permissions
4. You're connected!

## Usage

After setup, ask Claude to:
- "Show my unread emails"
- "What's on my calendar today?"
- "Find documents about project X in Drive"
- "Create a new spreadsheet for expense tracking"
- "Send an email to team@example.com"

## Troubleshooting

**"uvx not found"**
The script will auto-install `uv`. If it fails:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**"Claude CLI not found"**
Install Claude Code: `npm install -g @anthropic-ai/claude-code`

**Authentication issues**
Remove and re-setup:
```bash
claude mcp remove google-workspace
./setup.sh
```

**Wrong Google account**
Clear browser session cookies for accounts.google.com, then re-authenticate.
