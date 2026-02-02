#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "  🌸 Lily Installation"
echo "  ━━━━━━━━━━━━━━━━━━━━"
echo ""

# --- Check Node.js ---
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found."
  echo ""
  echo "   Please install Node.js 18+ first:"
  echo "   • macOS: brew install node"
  echo "   • Or visit: https://nodejs.org"
  echo ""
  exit 1
fi
NODE_VER=$(node -v)
echo "✓ Node.js $NODE_VER"

# --- Check/Install Claude CLI ---
CLAUDE_PATH=""
for p in /usr/local/bin/claude /opt/homebrew/bin/claude "$HOME/.npm-global/bin/claude" "$HOME/.local/bin/claude" "$HOME/.claude/local/claude"; do
  if [ -x "$p" ]; then
    CLAUDE_PATH="$p"
    break
  fi
done
if [ -z "$CLAUDE_PATH" ]; then
  CLAUDE_PATH=$(which claude 2>/dev/null || true)
fi

if [ -z "$CLAUDE_PATH" ]; then
  echo ""
  echo "📦 Installing Claude CLI..."
  npm install -g @anthropic-ai/claude-code || {
    echo ""
    echo "❌ Failed to install Claude CLI."
    echo "   Try running manually: npm install -g @anthropic-ai/claude-code"
    exit 1
  }
  # Re-check path after install
  CLAUDE_PATH=$(which claude 2>/dev/null || true)
  if [ -z "$CLAUDE_PATH" ]; then
    echo "❌ Claude CLI installed but not found in PATH."
    echo "   You may need to restart your terminal."
    exit 1
  fi
fi
echo "✓ Claude CLI: $CLAUDE_PATH"

# --- Check Claude Login / Run Login ---
echo ""
echo "🔐 Checking Claude authentication..."
# Try running claude with a simple command to check if logged in
if ! "$CLAUDE_PATH" -p "say ok" &>/dev/null; then
  echo ""
  echo "   You need to log in to Claude. A browser window will open."
  echo ""
  "$CLAUDE_PATH" login || {
    echo ""
    echo "❌ Claude login failed or was cancelled."
    echo "   Run 'claude login' manually to authenticate."
    exit 1
  }
fi
echo "✓ Claude authenticated"

# --- Extension ID ---
if [ -z "${1:-}" ]; then
  echo ""
  echo "📋 Enter your Chrome extension ID:"
  echo "   (Find it at chrome://extensions with Developer Mode on)"
  echo ""
  read -rp "   Extension ID: " EXT_ID
else
  EXT_ID="$1"
fi

if [ -z "$EXT_ID" ]; then
  echo "❌ Extension ID is required."
  exit 1
fi

# Validate format (32 lowercase letters)
if ! [[ $EXT_ID =~ ^[a-z]{32}$ ]]; then
  echo "⚠️  Extension ID looks unusual (expected 32 lowercase letters)"
  read -rp "   Continue anyway? (y/n) " CONFIRM
  if [[ ! $CONFIRM =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# --- Create ~/lily/ structure ---
echo ""
echo "📁 Creating Lily workspace..."
mkdir -p "$HOME/lily/sessions"
mkdir -p "$HOME/lily/state"
mkdir -p "$HOME/lily/skills"
mkdir -p "$HOME/lily/templates"
mkdir -p "$HOME/lily/memory"
mkdir -p "$HOME/lily/workflows"
mkdir -p "$HOME/lily/dumps"

# Default goals.json
if [ ! -f "$HOME/lily/state/goals.json" ]; then
  echo '[]' > "$HOME/lily/state/goals.json"
fi

# Copy starter skills if skills directory is empty
if [ -z "$(ls -A "$HOME/lily/skills" 2>/dev/null)" ]; then
  if [ -d "$SCRIPT_DIR/starter-skills" ]; then
    cp "$SCRIPT_DIR/starter-skills/"*.md "$HOME/lily/skills/" 2>/dev/null || true
    echo "✓ Starter skills installed"
  fi
fi

# Default CLAUDE.md
if [ ! -f "$HOME/lily/CLAUDE.md" ]; then
  cat > "$HOME/lily/CLAUDE.md" << 'CLAUDEEOF'
# Lily

You are Lily, a personal AI assistant. You help the user with daily tasks, goal tracking, and thoughtful conversation.

## Personality
- Concise and direct
- Warm but not effusive
- Action-oriented
- Remembers context from previous conversations via session logs

## Context
- Session logs are stored in ~/lily/sessions/ as daily markdown files
- Goals are in ~/lily/state/goals.json
- Skills are markdown files in ~/lily/skills/
CLAUDEEOF
fi
echo "✓ Workspace: ~/lily/"

# --- Install host script ---
echo ""
echo "🔧 Installing native host..."
mkdir -p "$HOME/.lily-host"

# If lily-host.js exists next to this script, copy it
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/lily-host.js" ]; then
  cp "$SCRIPT_DIR/lily-host.js" "$HOME/.lily-host/lily-host.js"
else
  # Download from GitHub
  curl -fsSL "https://raw.githubusercontent.com/unicreater/lily-assistant/main/native-host/lily-host.js" \
    -o "$HOME/.lily-host/lily-host.js" || {
    echo "❌ Could not download lily-host.js."
    exit 1
  }
fi
chmod +x "$HOME/.lily-host/lily-host.js"

# Create shell wrapper (Chrome native messaging works better with a shell script on macOS)
NODE_BIN=$(which node)
cat > "$HOME/.lily-host/lily-host" << WRAPPER_EOF
#!/bin/bash
exec "$NODE_BIN" "\$HOME/.lily-host/lily-host.js"
WRAPPER_EOF
chmod +x "$HOME/.lily-host/lily-host"
echo "✓ Native host installed"

# --- Register native messaging manifest ---
echo ""
echo "📝 Registering with Chrome..."
HOST_NAME="com.lily.host"
HOST_PATH="$HOME/.lily-host/lily-host"

# macOS
if [ "$(uname)" = "Darwin" ]; then
  BROWSER_DIRS=(
    "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
    "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  )
# Linux
elif [ "$(uname)" = "Linux" ]; then
  BROWSER_DIRS=(
    "$HOME/.config/google-chrome/NativeMessagingHosts"
    "$HOME/.config/chromium/NativeMessagingHosts"
    "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  )
else
  echo "⚠️  Unsupported OS. You'll need to register the native messaging manifest manually."
  BROWSER_DIRS=()
fi

for DIR in "${BROWSER_DIRS[@]}"; do
  mkdir -p "$DIR"
  cat > "$DIR/$HOST_NAME.json" << MANIFEST_EOF
{
  "name": "$HOST_NAME",
  "description": "Lily native messaging host",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
MANIFEST_EOF
done
echo "✓ Registered with browsers"

# --- Done ---
echo ""
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Installation complete!"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Next steps:"
echo "  1. Fully quit Chrome (Cmd+Q / Alt+F4)"
echo "  2. Reopen Chrome"
echo "  3. Click the Lily extension icon"
echo ""
echo "  Enjoy using Lily! 🌸"
echo ""
