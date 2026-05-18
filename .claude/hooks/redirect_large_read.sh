#!/usr/bin/env bash
# .claude/hooks/redirect_large_read.sh
set -euo pipefail

input=$(cat)
file=$(echo "$input" | jq -r '.tool_input.file_path // ""')

# Only intercept if it's a source file (not config/markdown)
if [[ "$file" =~ \.(py|ts|js|rs|go|java)$ ]]; then
  size=$(wc -c < "$file" 2>/dev/null || echo 0)
  if [ "$size" -gt 5000 ]; then
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "File '${file}' is large (${size} bytes). Use mcp__sourcerer__get_chunk or mcp__codegraph__get_symbol instead of reading the whole file. Query only the function or class you need."
  }
}
EOF
    exit 0
  fi
fi
exit 0