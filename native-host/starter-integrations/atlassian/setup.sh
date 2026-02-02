#!/bin/bash
# Atlassian MCP Setup (Jira & Confluence)
# Browser-based OAuth - no API keys needed

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Atlassian MCP Setup                  ║${NC}"
echo -e "${BLUE}║   Jira & Confluence access             ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo

# Check for Claude CLI
if ! command -v claude &> /dev/null; then
    echo -e "${RED}Error: Claude CLI not found${NC}"
    echo "Please install Claude Code first:"
    echo "  npm install -g @anthropic-ai/claude-code"
    exit 1
fi
echo -e "${GREEN}✓ Claude CLI found${NC}"

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
echo -e "${YELLOW}Removing existing Atlassian config (if any)...${NC}"
claude mcp remove atlassian 2>/dev/null || true

# Add the MCP server
echo -e "${YELLOW}Adding Atlassian MCP server...${NC}"
claude mcp add atlassian $SCOPE_FLAG --transport http https://mcp.atlassian.com/v1/mcp

echo
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Almost Done!                         ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo
echo -e "${YELLOW}Next step: Authenticate with Atlassian${NC}"
echo
echo "Run this command to complete authentication:"
echo -e "  ${BLUE}claude mcp${NC}"
echo
echo "This will open your browser to log into Atlassian."
echo "Grant access to your Jira and/or Confluence workspace."
echo
