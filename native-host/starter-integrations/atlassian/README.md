# Atlassian Integration

Access Jira and Confluence through Claude.

## Capabilities

- **Jira**: Create/view issues, search, manage sprints
- **Confluence**: Read/create pages, search content

## Prerequisites

- Claude Code CLI installed
- Atlassian account (Jira Cloud and/or Confluence)

## Setup

Run the setup script:
```bash
./setup.sh
```

The script will:
1. Verify Claude CLI is installed
2. Ask for scope (all projects or current only)
3. Register the Atlassian MCP server
4. Prompt you to authenticate via browser

After the script completes, run:
```bash
claude mcp
```
This opens your browser to authenticate with Atlassian.

## Usage

After setup, ask Claude to:
- "Show my open Jira issues"
- "Create a new bug ticket in PROJECT"
- "Find Confluence pages about authentication"
- "What's in the current sprint?"

## Troubleshooting

**"Authentication failed"**
Re-run authentication:
```bash
claude mcp
```

**"Claude CLI not found"**
Install Claude Code: `npm install -g @anthropic-ai/claude-code`

**Need to switch accounts**
Remove and re-setup:
```bash
claude mcp remove atlassian
./setup.sh
```
