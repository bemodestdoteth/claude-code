#!/usr/bin/env python3
# .claude/hooks/prompt_router.py
import json
import sys

data = json.load(sys.stdin)
prompt = data.get("prompt", "").lower()

context_parts = [
    "Use mcp__context7__resolve-library-id + mcp__context7__query-docs for every library you encounter."
]

# ── Code intelligence ──

if any(k in prompt for k in ["find code", "similar to", "where is", "search for"]):
    context_parts.append(
        "TOOL ROUTING: This looks like a semantic search task. "
        "Use mcp__sourcerer__search_code — do NOT use Grep or Read."
    )

if any(
    k in prompt
    for k in ["who calls", "what uses", "impact of", "depends on", "callers"]
):
    context_parts.append(
        "TOOL ROUTING: This is a dependency/impact question. "
        "Use mcp__codegraph__find_callers or mcp__codegraph__impact_analysis — not Grep."
    )

if any(
    k in prompt for k in ["all async", "all functions that", "pattern", "ast", "syntax"]
):
    context_parts.append(
        "TOOL ROUTING: This is a structural pattern search. "
        "Use ast-grep skill — not plain grep."
    )

# ── Data & storage ──

if any(
    k in prompt
    for k in [
        "mongo",
        "database",
        "codys.",
        "codys-private.",
        "collection",
        "schema",
        "document",
        "query",
        "index",
        "aggregation",
    ]
):
    context_parts.append(
        "TOOL ROUTING: MongoDB is the primary data store. "
        "Use MongoDB MCP tools (mcp__mongodb__*) to inspect live schema/collections before writing code. "
        "Do NOT mock MongoDB in tests — use .env.example variables."
    )

# ── Security ──

if any(
    k in prompt
    for k in [
        "security",
        "vulnerability",
        "semgrep",
        "scan",
        "secure",
        "xss",
        "sqli",
        "csrf",
        "ssrf",
    ]
):
    context_parts.append(
        "TOOL ROUTING: Security-related task. "
        "Use mcp__plugin_semgrep-plugin_semgrep__semgrep_scan or mcp__plugin_semgrep-plugin_semgrep__semgrep_findings first. "
        "Prefer secure-by-default libraries (see awesome-secure-defaults)."
    )

# ── Git workflow ──

if any(
    k in prompt
    for k in [
        "commit",
        "diff",
        "branch",
        "rebase",
        "merge",
        "cherry-pick",
        "log",
        "blame",
        "stash",
        "pr ",
        "pull request",
    ]
):
    context_parts.append(
        "TOOL ROUTING: Git operation. "
        "Use mcp__git-operator__* or mcp__git-ingest__* tools — not raw 'git' Bash commands. "
        "Run uv run pre-commit run --all-files before committing."
    )

# ── Python ──

if any(k in prompt for k in ["test", "pytest", "unittest", "fixture", "mock"]):
    context_parts.append(
        "TOOL ROUTING: Testing task. Use uv run pytest my_exchanges/tests/ — never invoke pytest directly. "
        "Test files belong in my_exchanges/tests/ only, pattern test_*.py."
    )

if any(
    k in prompt
    for k in ["dependency", "install package", "requirements", "uv add", "pip install"]
):
    context_parts.append(
        "TOOL ROUTING: Dependency task. Use uv add <package> — never pip install. "
        "Always work inside the virtual environment."
    )

# ── Domain-specific skills ──

if any(
    k in prompt
    for k in [
        "telegram",
        "tg bot",
        "bot handler",
        "callback",
        "conversation",
        "inline keyboard",
    ]
):
    context_parts.append(
        "SKILL ROUTING: Telegram bot work. Invoke skill 'telegram-bot-builder' for handler/conversation patterns."
    )

if any(
    k in prompt
    for k in ["trading", "backtest", "strategy", "portfolio", "risk", "pnl", "position"]
):
    context_parts.append(
        "SKILL ROUTING: Quant/trading work. Consider skills 'quant-analyst' or 'risk-manager'."
    )

# ── Python-specific skills ──

if any(k in prompt for k in ["python"]):
    context_parts.append(
        "SKILL ROUTING: Modern Python features."
        "Invoke skill 'python-pro' for Python 3.12+ idioms and patterns."
        "Invoke skill 'uv-package-manager' for fast Python dependency workflows."
        "Invoke skill 'python-performance-optimization' for profiling and optimization."
    )

if any(
    k in prompt
    for k in [
        "asyncio",
        "asymc",
        "await",
        "concurrent",
        "event loop",
        "coroutine",
        "gather",
        "task group",
    ]
):
    context_parts.append(
        "SKILL ROUTING: Async Python patterns. Invoke skill 'async-python-patterns' for concurrency best practices."
    )

if any(
    k in prompt
    for k in [
        "pytest",
        "fixture",
        "mock",
        "patch",
        "parametrize",
        "test coverage",
        "unit test",
    ]
):
    context_parts.append(
        "SKILL ROUTING: Python testing. Invoke skill 'python-testing-patterns' for pytest strategies and fixture design."
    )

# ── Complex reasoning ──

if any(
    k in prompt
    for k in [
        "break down",
        "step by step",
        "multi-step",
        "complex problem",
        "think through",
        "reasoning",
    ]
):
    context_parts.append(
        "TOOL ROUTING: Complex reasoning task. "
        "Use mcp__sequential-thinking__sequentialthinking to decompose before acting."
    )

# ── Output ──

if context_parts:
    print(json.dumps({"additionalContext": "\n".join(context_parts)}))
# exit 0 implicitly — no output means no injection
