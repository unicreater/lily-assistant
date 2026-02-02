#!/bin/bash
# Google Workspace MCP Setup
# Gmail, Calendar, Drive, Docs, Sheets, Slides

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Google Workspace MCP Setup           ║${NC}"
echo -e "${BLUE}║   Gmail, Calendar, Drive, Docs & more  ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo

# Check for uv/uvx
if ! command -v uvx &> /dev/null; then
    echo -e "${YELLOW}uvx not found. Installing uv...${NC}"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    # Source the env to get uvx in PATH
    export PATH="$HOME/.local/bin:$PATH"
    if ! command -v uvx &> /dev/null; then
        echo -e "${RED}Error: Failed to install uv${NC}"
        echo "Please install manually: https://docs.astral.sh/uv/"
        exit 1
    fi
fi
echo -e "${GREEN}✓ uvx found${NC}"

# Check for Claude CLI
if ! command -v claude &> /dev/null; then
    echo -e "${RED}Error: Claude CLI not found${NC}"
    echo "Please install Claude Code first:"
    echo "  npm install -g @anthropic-ai/claude-code"
    exit 1
fi
echo -e "${GREEN}✓ Claude CLI found${NC}"

# OAuth Credentials
# Users must provide their own Google OAuth credentials
# Get them from: https://console.cloud.google.com/apis/credentials

if [ -z "$GOOGLE_OAUTH_CLIENT_ID" ] || [ -z "$GOOGLE_OAUTH_CLIENT_SECRET" ]; then
    echo
    echo -e "${YELLOW}Google OAuth credentials required.${NC}"
    echo
    echo "To get credentials:"
    echo "  1. Go to https://console.cloud.google.com/apis/credentials"
    echo "  2. Create a new OAuth 2.0 Client ID (Desktop app)"
    echo "  3. Enable the APIs you need (Gmail, Drive, Calendar, etc.)"
    echo
    read -p "Enter your Client ID: " CLIENT_ID
    read -p "Enter your Client Secret: " CLIENT_SECRET

    if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
        echo -e "${RED}Error: Client ID and Secret are required${NC}"
        exit 1
    fi
else
    CLIENT_ID="$GOOGLE_OAUTH_CLIENT_ID"
    CLIENT_SECRET="$GOOGLE_OAUTH_CLIENT_SECRET"
    echo -e "${GREEN}✓ Using credentials from environment variables${NC}"
fi

# Ask for scope
echo
echo -e "${YELLOW}Where should this integration be available?${NC}"
echo "  1) All projects (user-scoped)"
echo "  2) Current project only"
read -p "Choice [1]: " scope_choice
scope_choice=${scope_choice:-1}

SCOPE_FLAG=""
if [ "$scope_choice" = "2" ]; then
    SCOPE_FLAG="--scope project"
    echo -e "${BLUE}Installing for current project only${NC}"
else
    echo -e "${BLUE}Installing for all projects${NC}"
fi

# Remove existing if present
echo
echo -e "${YELLOW}Removing existing Google Workspace config (if any)...${NC}"
claude mcp remove google-workspace 2>/dev/null || true

# Add the MCP server
echo -e "${YELLOW}Adding Google Workspace MCP server...${NC}"
# Note: Excluding Tasks API due to known scope bug
# Use full path to uvx to ensure it's found
UVX_PATH="$HOME/.local/bin/uvx"
claude mcp add google-workspace $SCOPE_FLAG \
    -e GOOGLE_OAUTH_CLIENT_ID="$CLIENT_ID" \
    -e GOOGLE_OAUTH_CLIENT_SECRET="$CLIENT_SECRET" \
    -- "$UVX_PATH" workspace-mcp --tools gmail drive calendar docs sheets slides

echo
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Setup Complete!                      ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo
echo -e "${YELLOW}Authentication:${NC}"
echo "The first time you ask Claude to access Google services,"
echo "a browser window will open for you to sign in with your"
echo "Google account and grant permissions."
echo
echo "Available tools: Gmail, Drive, Calendar, Docs, Sheets, Slides"
echo
