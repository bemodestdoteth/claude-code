#!/usr/bin/env bash
# .claude/hooks/redirect_git_to_mcp.sh
set -euo pipefail

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // ""')

# Deny raw git commands that have MCP equivalents.
# Allow: clone, init, config, remote (complex), submodule, fsck, gc.
if echo "$command" | grep -Eq '^git\s+(status|log|diff|show|blame|branch|checkout|merge|rebase|cherry-pick|stash|tag|reset|reflog|commit|push|pull|fetch|add)'; then
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Use MCP git tools instead of raw 'git' Bash commands: mcp__git-operator__git_status, mcp__git-operator__git_log, mcp__git-operator__git_diff, mcp__git-ingest__git_show, mcp__git-operator__git_commit, mcp__git-operator__git_push, etc. These provide structured output and better integration."
  }
}
EOF
  exit 0
fi
exit 0
