#!/usr/bin/env bash
# .claude/hooks/redirect_mongo_to_mcp.sh
set -euo pipefail

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // ""')

if echo "$command" | grep -Eq '^(mongosh|mongo|mongodump|mongorestore|mongostat)(\s|$)'; then
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Do not use raw MongoDB CLI commands. Use MongoDB MCP tools (mcp__mongodb__find, mcp__mongodb__aggregate, mcp__mongodb__collection-schema, mcp__mongodb__count, etc.) to inspect live schema and run queries with structured output."
  }
}
EOF
  exit 0
fi
exit 0
