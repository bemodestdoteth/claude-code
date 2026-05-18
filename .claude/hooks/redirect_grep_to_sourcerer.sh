#!/usr/bin/env bash
# .claude/hooks/redirect_grep_to_sourcerer.sh
set -euo pipefail

# Read the tool input JSON from stdin
input=$(cat)
pattern=$(echo "$input" | jq -r '.tool_input.pattern // ""')
path=$(echo "$input" | jq -r '.tool_input.path // "."')

# Deny and tell Claude to use sourcerer instead
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Do not use Grep for codebase search. Instead call mcp__sourcerer__search_code with query='${pattern}' to get semantically relevant results without reading full files. This saves tokens and returns higher-quality matches."
  }
}
EOF
exit 0