---
name: local-llm
description: "Guide for using the my_exchanges local LLM routing layer. MongoDB-backed endpoint registry, tiered routing, health checks, and OpenAI-compatible client."
triggers:
  - /local-llm
  - "local llm"
  - "llm backend"
  - "llama.cpp routing"
  - "ollama routing"
risk: unknown
source: project
date_added: '2026-05-08'
---

# Local LLM Routing

The `my_exchanges.core.llm` package provides a unified client for multiple local LLM backends (llama.cpp, ollama, etc.) on the same network.

## Quick Reference

```python
from my_exchanges.core.llm.client import LLMClient
from my_exchanges.core.llm.models import ChatMessage

client = LLMClient()
response = await client.chat(
    model="qwen2.5-coder:32b",
    messages=[ChatMessage(role="user", content="Hello")],
)
print(response.choices[0].message.content)
```

## When to Use

- Any feature needs LLM inference (summarization, classification, code generation)
- You want automatic fallback between multiple local backends
- You need structured JSON output from a local model

## Do Not Use When

- The task can be solved with simple string manipulation or regex
- You need a model not registered in the endpoint registry
- Real-time streaming is required and no healthy endpoints exist

## Architecture

- **Registry** (`LLMRegistry`): MongoDB `codys.llm_endpoints` collection storing endpoint URLs, models, tier, priority, and health status.
- **Router** (`LLMRouter`): Selects the best endpoint by model match → tier match → any enabled → config fallback.
- **Health Checker** (`LLMHealthChecker`): Queries each endpoint's `/v1/models` via APScheduler cron job every 30 seconds.
- **Client** (`LLMClient`): OpenAI-compatible chat completion with streaming and structured JSON support.

## Adding an Endpoint

Set `LLM_ENDPOINTS_JSON` before app startup:

```bash
export LLM_ENDPOINTS_JSON='[{"url": "http://192.168.1.10:8080", "models": ["qwen2.5-coder:32b"], "tier": "capable", "priority": 0}]'
```

Or insert via registry directly:

```python
from my_exchanges.core.llm.registry import LLMRegistry
from my_exchanges.core.llm.models import LLMEndpoint

reg = LLMRegistry()
await reg.create_endpoint(LLMEndpoint(
    url="http://192.168.1.10:8080",
    models=["qwen2.5-coder:32b"],
    tier="capable",
    priority=0,
    enabled=True,
))
```

## Tiers

| Tier | Purpose |
|------|---------|
| `fast` | Small models, low latency (e.g., 8B parameters) |
| `capable` | Large models, high quality (e.g., 70B+ parameters) |
| `fallback` | Last-resort endpoints |

## Environment Variables

- `LLM_BASE_URL` — Fallback base URL when registry is empty
- `LLM_DEFAULT_MODEL` — Fallback model name
- `LLM_TIMEOUT` — Request timeout in seconds (default: 60)
- `LLM_MAX_RETRIES` — Retry attempts per request (default: 3)
- `LLM_HEALTH_CHECK_INTERVAL` — Health check interval in seconds (default: 30)
- `LLM_ENDPOINTS_JSON` — JSON array to bootstrap endpoints on startup
