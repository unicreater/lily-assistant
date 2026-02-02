#!/bin/bash
# Parallel Search MCP Setup
# Free web search - no authentication required

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Parallel Search MCP Setup            ║${NC}"
echo -e "${BLUE}║   Free web search for Claude           ║${NC}"
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
echo -e "${YELLOW}Removing existing Parallel Search config (if any)...${NC}"
claude mcp remove parallel-search 2>/dev/null || true

# Add the MCP server
echo -e "${YELLOW}Adding Parallel Search MCP server...${NC}"
claude mcp add parallel-search $SCOPE_FLAG --transport http https://search-mcp.parallel.ai/mcp

echo
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Setup Complete!                      ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo
echo -e "Parallel Search is now available in Claude."
echo -e "Try asking Claude to search the web for something!"
echo
