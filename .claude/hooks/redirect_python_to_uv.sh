#!/usr/bin/env bash
# .claude/hooks/redirect_python_to_uv.sh
set -euo pipefail

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // ""')

# Deny direct python/pip/pytest invocations (but allow inside scripts like 'echo "python ..."')
if echo "$command" | grep -Eq '^(python[0-9]*(\s|$)|pip[0-9]*(\s|$)|pytest(\s|$))'; then
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Do not invoke python, pip, or pytest directly. Use 'uv run <command>' instead. Examples: uv run pytest my_exchanges/tests/, uv run python script.py, uv run pip list."
  }
}
EOF
  exit 0
fi
exit 0
