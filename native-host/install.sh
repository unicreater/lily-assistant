#!/usr/bin/env bash
set -euo pipefail

echo "=== Lily Native Host Installer ==="
echo ""

# --- Check Node.js ---
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install Node.js 18+ first."
  exit 1
fi
NODE_VER=$(node -v)
echo "Node.js: $NODE_VER"

# --- Check Claude CLI ---
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
  echo "WARNING: Claude CLI not found. Chat/briefing will not work until installed."
else
  echo "Claude CLI: $CLAUDE_PATH"
fi

# --- Extension ID ---
if [ -z "${1:-}" ]; then
  echo ""
  echo "Enter your Chrome extension ID (from chrome://extensions with developer mode):"
  read -r EXT_ID
else
  EXT_ID="$1"
fi

if [ -z "$EXT_ID" ]; then
  echo "ERROR: Extension ID is required."
  exit 1
fi
echo "Extension ID: $EXT_ID"

# --- Create ~/lily/ structure ---
echo ""
echo "Creating ~/lily/ directory structure..."
mkdir -p "$HOME/lily/sessions"
mkdir -p "$HOME/lily/state"
mkdir -p "$HOME/lily/skills"
mkdir -p "$HOME/lily/templates"

# Default goals.json
if [ ! -f "$HOME/lily/state/goals.json" ]; then
  echo '[]' > "$HOME/lily/state/goals.json"
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

# --- Install host script ---
echo "Installing native host to ~/.lily-host/..."
mkdir -p "$HOME/.lily-host"

# If lily-host.js exists next to this script, copy it
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/lily-host.js" ]; then
  cp "$SCRIPT_DIR/lily-host.js" "$HOME/.lily-host/lily-host.js"
else
  # Download from GitHub (for users who only have the install script)
  echo "Downloading lily-host.js..."
  curl -fsSL "https://raw.githubusercontent.com/unicreater/lily-assistant/main/native-host/lily-host.js" \
    -o "$HOME/.lily-host/lily-host.js" || {
    echo "ERROR: Could not download lily-host.js."
    echo "Check your internet connection or visit https://github.com/unicreater/lily-assistant"
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

# --- Register native messaging manifest ---
HOST_NAME="com.lily.host"
HOST_PATH="$HOME/.lily-host/lily-host"
NODE_PATH=$(which node)

# macOS
if [ "$(uname)" = "Darwin" ]; then
  # Chrome
  CHROME_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  # Chromium
  CHROMIUM_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
  # Brave
  BRAVE_DIR="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"

  for DIR in "$CHROME_DIR" "$CHROMIUM_DIR" "$BRAVE_DIR"; do
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
    echo "  Registered: $DIR/$HOST_NAME.json"
  done

# Linux
elif [ "$(uname)" = "Linux" ]; then
  CHROME_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
  CHROMIUM_DIR="$HOME/.config/chromium/NativeMessagingHosts"
  BRAVE_DIR="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"

  for DIR in "$CHROME_DIR" "$CHROMIUM_DIR" "$BRAVE_DIR"; do
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
    echo "  Registered: $DIR/$HOST_NAME.json"
  done
else
  echo "WARNING: Unsupported OS. Manually register native messaging manifest."
fi

echo ""
echo "=== Installation complete ==="
echo "  Lily dir:  ~/lily/"
echo "  Host:      ~/.lily-host/lily-host.js"
echo "  Manifest:  $HOST_NAME"
echo ""
echo "Next: Load the extension in Chrome, then restart the browser."
