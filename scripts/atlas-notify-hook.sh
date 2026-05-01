#!/bin/sh
# Atlas notification hook — Claude Code Notification hook
# Writes notification.json so the Rust file watcher can emit a Tauri event.
# See: https://code.claude.com/docs/en/hooks#notification

INPUT=$(cat)

# Need a session ID from the Atlas terminal
SESSION_ID="${ATLAS_SESSION_ID:-}"
if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Validate SESSION_ID to prevent path traversal
if ! echo "$SESSION_ID" | grep -qE '^[a-zA-Z0-9_-]+$'; then
  exit 1
fi

# Session directory
SESSION_DIR="$HOME/.atlas/sessions/$SESSION_ID"
mkdir -p "$SESSION_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Extract fields and write notification.json
# Use jq to safely handle the input JSON and build the output
NOTIFICATION_TYPE=$(printf '%s' "$INPUT" | jq -r '.notification_type // "unknown"' 2>/dev/null)
TITLE=$(printf '%s' "$INPUT" | jq -r '.title // ""' 2>/dev/null)
MESSAGE=$(printf '%s' "$INPUT" | jq -r '.message // ""' 2>/dev/null)

# Fall back to type-specific titles when none provided
if [ -z "$TITLE" ]; then
  TOOL_NAME="${ATLAS_TOOL_NAME:-Agent}"
  case "$NOTIFICATION_TYPE" in
    permission_prompt)  TITLE="$TOOL_NAME needs permission" ;;
    idle_prompt)        TITLE="$TOOL_NAME is waiting" ;;
    auth_success)       TITLE="$TOOL_NAME authenticated" ;;
    elicitation_dialog) TITLE="$TOOL_NAME needs input" ;;
    *)                  TITLE="$TOOL_NAME" ;;
  esac
fi

# Write notification.json — the Rust file watcher picks this up
jq -n \
  --arg type "$NOTIFICATION_TYPE" \
  --arg title "$TITLE" \
  --arg message "$MESSAGE" \
  --arg timestamp "$TIMESTAMP" \
  '{notification_type: $type, title: $title, message: $message, timestamp: $timestamp}' \
  > "$SESSION_DIR/notification.json"

exit 0
