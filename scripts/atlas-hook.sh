#!/bin/bash
# Atlas panel updater — Claude Code Stop hook
# Discovers diff using sift-style 3-tier strategy and writes panel.json.
# Matches the logic in sift/src/core/repo.ts:extractBestDiff()

INPUT=$(cat)

CWD=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
if [ -z "$CWD" ]; then
  exit 0
fi

# Need a session ID from the Atlas terminal
SESSION_ID="${ATLAS_SESSION_ID:-}"
if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Validate SESSION_ID to prevent path traversal
if ! echo "$SESSION_ID" | grep -qE '^[a-zA-Z0-9_-]+$'; then
  exit 1
fi

# Resolve to git repository root (CWD may be a subdirectory)
GIT_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)
if [ -z "$GIT_ROOT" ]; then
  exit 0
fi

# Session directory
SESSION_DIR="$HOME/.atlas/sessions/$SESSION_ID"
mkdir -p "$SESSION_DIR"

# === 3-tier diff discovery (mirrors sift's extractBestDiff) ===

RAW_DIFF=""

# Tier 1: Working tree changes — staged + unstaged vs HEAD
# This is the most common case during active editing
RAW_DIFF=$(git -C "$GIT_ROOT" diff HEAD 2>/dev/null)

# If HEAD doesn't exist yet (initial commit), try just `git diff`
if [ -z "$RAW_DIFF" ]; then
  RAW_DIFF=$(git -C "$GIT_ROOT" diff 2>/dev/null)
fi

# Also check staged-only changes
if [ -z "$RAW_DIFF" ]; then
  RAW_DIFF=$(git -C "$GIT_ROOT" diff --cached 2>/dev/null)
fi

# Tier 2: Unpushed commits vs upstream tracking branch
# Catches changes that have been committed but not pushed
if [ -z "$RAW_DIFF" ]; then
  UPSTREAM=$(git -C "$GIT_ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
  if [ -n "$UPSTREAM" ]; then
    RAW_DIFF=$(git -C "$GIT_ROOT" diff "${UPSTREAM}..HEAD" 2>/dev/null)
  fi
fi

# Tier 3: Branch diff vs merge-base with main/master
# Catches all changes on a feature branch
if [ -z "$RAW_DIFF" ]; then
  BASE_BRANCH="main"
  if ! git -C "$GIT_ROOT" rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
    BASE_BRANCH="master"
    if ! git -C "$GIT_ROOT" rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
      BASE_BRANCH=""
    fi
  fi

  if [ -n "$BASE_BRANCH" ]; then
    MERGE_BASE=$(git -C "$GIT_ROOT" merge-base "$BASE_BRANCH" HEAD 2>/dev/null)
    if [ -n "$MERGE_BASE" ]; then
      RAW_DIFF=$(git -C "$GIT_ROOT" diff "${MERGE_BASE}..HEAD" 2>/dev/null)
    fi
  fi
fi

# No diff found at any tier — nothing to show
if [ -z "$RAW_DIFF" ]; then
  exit 0
fi

# Compute stats
FILES_CHANGED=$(echo "$RAW_DIFF" | grep -c '^diff --git' || echo 0)
LINES_ADDED=$(echo "$RAW_DIFF" | grep -c '^+[^+]' || echo 0)
LINES_REMOVED=$(echo "$RAW_DIFF" | grep -c '^-[^-]' || echo 0)

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Discover the most recent implementation plan (if any)
PLAN_JSON=""
PLANS_DIR="$GIT_ROOT/.claude/plans"
if [ -d "$PLANS_DIR" ]; then
  LATEST_PLAN=$(find "$PLANS_DIR" -maxdepth 1 -name '*.md' -type f -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null | head -1)
  if [ -n "$LATEST_PLAN" ] && [ -f "$LATEST_PLAN" ]; then
    # Truncate large plans at the last complete line before 5KB.
    # head -c grabs raw bytes; if the file was larger, the final line
    # is likely incomplete, so drop it to avoid cutting mid-sentence.
    PLAN_RAW=$(head -c 5120 "$LATEST_PLAN")
    FILE_SIZE=$(wc -c < "$LATEST_PLAN" | tr -d ' ')
    if [ "$FILE_SIZE" -gt 5120 ]; then
      PLAN_TEXT=$(printf '%s' "$PLAN_RAW" | sed '$d')
    else
      PLAN_TEXT="$PLAN_RAW"
    fi
    PLAN_JSON=$(printf ',\n  "plan": %s' "$(echo "$PLAN_TEXT" | jq -Rs .)")
  fi
fi

# Write panel.json — the Rust file watcher picks this up and emits to frontend
cat > "$SESSION_DIR/panel.json" << PANEL_EOF
{
  "version": 1,
  "timestamp": "$TIMESTAMP",
  "cwd": "$GIT_ROOT",
  "diff": {
    "raw": $(echo "$RAW_DIFF" | jq -Rs .),
    "files_changed": $FILES_CHANGED,
    "lines_added": $LINES_ADDED,
    "lines_removed": $LINES_REMOVED
  }${PLAN_JSON}
}
PANEL_EOF

exit 0
