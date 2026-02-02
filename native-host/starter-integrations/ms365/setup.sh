#!/bin/bash
# Microsoft 365 MCP Setup
# Device code flow - no API keys needed

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Microsoft 365 MCP Setup              ║${NC}"
echo -e "${BLUE}║   Mail, Calendar, Files, Teams         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo

# Check for npx
if ! command -v npx &> /dev/null; then
    echo -e "${RED}Error: npx not found${NC}"
    echo "Please install Node.js first: https://nodejs.org"
    exit 1
fi
echo -e "${GREEN}✓ npx found${NC}"

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

# Ask for account type
echo
echo -e "${YELLOW}What type of Microsoft account?${NC}"
echo "  1) Work or school account"
echo "  2) Personal account (Outlook.com, Hotmail)"
echo "  3) Both"
read -p "Choice [1]: " account_choice
account_choice=${account_choice:-1}

ACCOUNT_FLAGS=""
case $account_choice in
    1) ACCOUNT_FLAGS="" ;;
    2) ACCOUNT_FLAGS="-e MS365_PERSONAL_ACCOUNT=true" ;;
    3) ACCOUNT_FLAGS="-e MS365_ALLOW_ALL_ACCOUNTS=true" ;;
esac

# Ask for tools
echo
echo -e "${YELLOW}Which tools do you need?${NC}"
echo "  1) All tools (Mail, Calendar, Files, Teams)"
echo "  2) Essentials only (Mail, Calendar, Files)"
read -p "Choice [1]: " tools_choice
tools_choice=${tools_choice:-1}

TOOLS_FLAGS=""
if [ "$tools_choice" = "2" ]; then
    TOOLS_FLAGS="-e MS365_TOOLS=mail,calendar,files"
fi

# Remove existing if present
echo
echo -e "${YELLOW}Removing existing MS365 config (if any)...${NC}"
claude mcp remove ms365 2>/dev/null || true

# Add the MCP server
echo -e "${YELLOW}Adding Microsoft 365 MCP server...${NC}"
claude mcp add ms365 $SCOPE_FLAG $ACCOUNT_FLAGS $TOOLS_FLAGS -- npx -y @softeria/ms-365-mcp-server

echo
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Setup Complete!                      ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo
echo -e "${YELLOW}Authentication:${NC}"
echo "When you first use MS365 features in Claude, you'll see:"
echo "  1. A URL to visit (https://microsoft.com/devicelogin)"
echo "  2. A code to enter"
echo "  3. Sign in with your Microsoft account"
echo
echo "This is the device code flow - secure and easy!"
echo
