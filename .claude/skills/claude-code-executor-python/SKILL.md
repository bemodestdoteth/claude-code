---
name: claude-code-executor-python
description: "Project-specific Python skill for my_exchanges. Encodes core library usage, mypy strict patterns, Pydantic v2 models, async MongoDB, exception hierarchy, pytest-asyncio testing, ruff formatting, import isolation, and uv workflow."
triggers:
  - /claude-code-executor-python
risk: unknown
source: project
date_added: '2026-05-07'
---

# my_exchanges Python

You are a Python developer working in the `my_exchanges` codebase — a Python 3.12+ crypto exchange/wallet automation library. Every line of code must respect the project's architectural rules, import constraints, and core library contracts.

## Use this skill when

- Writing or editing any Python file inside `my_exchanges/`
- Adding new exchange REST/WebSocket implementations
- Adding wallet chain or contract modules
- Writing tests in `my_exchanges/tests/`
- Running type checks, linting, or tests
- Interacting with MongoDB, HTTP, logging, or configuration
- Executing an approved OMC plan or post-approval handoff that targets `my_exchanges` Python code

## Do not use this skill when

- The task is outside `my_exchanges/` (e.g., infrastructure, unrelated scripts)
- You are only reading code without intent to modify it or prepare implementation
- The task is purely data analysis with no code changes

---

## Domain Skill Routing

Invoke the relevant domain skill before implementing when the current task matches one of these signals. Use the embedded checks below for routine work; use this table when the task enters a specialized domain.

| Domain | Detection Signal | Skill to Invoke | Invoke When |
|--------|------------------|-----------------|-------------|
| Telegram bots and notifications | Files under `extensions/websites/telegram/`, `python-telegram-bot` imports, bot handlers, commands, or webhook code | `/telegram-bot-builder` | Before implementing Telegram handlers, commands, or webhook behavior |
| Database query optimization | Complex MongoDB aggregations, `$lookup`, `$group`, pipeline design, index decisions, or slow-query work | `/database-optimizer` | Query shape is non-trivial or performance is a stated concern |
| Complex async patterns | `asyncio.gather`, `TaskGroup`, semaphores, background task lifecycle, backpressure, or connection pools | `/async-python` | Async concurrency or resource lifecycle goes beyond simple `await` usage |
| Complex typing | Generics, Protocols, `TypeVar`, `ParamSpec`, covariance, or difficult `mypy --strict` failures | `/python-pro` | Standard annotations or `cast()` are insufficient |
| Dependencies and uv workflow | Adding packages, editing `pyproject.toml`, resolving lock conflicts, or changing dependency groups | `/uv` | Before `uv add`, lockfile updates, or dependency troubleshooting |
| Test strategy and TDD | New behavior needing test-first design, disputed test adequacy, integration test design, or red-green-refactor workflow | `/tdd` | Test design is non-trivial or the approved plan calls for TDD |
| Local LLM routing | `my_exchanges.core.llm`, llama.cpp/ollama endpoint registration, model routing, or health checks | `/local-llm` | Touching LLM backend routing or endpoint registry code |
| Performance profiling | Slow Python code, cProfile, memory profiling, hot-path optimization, or benchmark-driven changes | `/optimize-python` | A performance bottleneck must be diagnosed or fixed |

---

## OMC Post-Plan Execution Contract

When an approved OMC plan or `Post-Approval Handoff` exists, treat it as the source of truth. Do not re-plan, expand scope, or reinterpret requirements unless the plan conflicts with current code or a blocker appears.

1. Confirm the target files, constraints, assumptions, and validation steps from the approved plan.
2. Inspect only the files needed for the current execution step.
3. Reuse existing `my_exchanges.core` wrappers and project patterns before adding anything new.
4. Stop and escalate if the plan is missing, contradicted by code, requires credentials/secrets, changes financially risky behavior, or affects unrelated exchange/wallet flows.
5. Report changed files, validation evidence, unresolved blockers, and any assumptions needed to complete the handoff.

## Validation Feedback Loop

After implementation, hand the executor report to `/claude-code-validator-python`. If validation returns `PASS`, stop. If it returns `PASS_WITH_FIXES` or `FAIL`, treat the validator findings as a constrained follow-up handoff: fix only the cited issues, preserve the approved plan scope, then request validation again. If validation returns `BLOCKED`, supply missing artifacts/evidence or return to `/claude-code-plan` or the user only when the blocker is plan-level.

---

## Embedded Execution Checks

Use these compact checks directly during implementation. Invoke full external skills only when the task exceeds these rules.

| Area | Embedded Check | Escalate When |
|------|----------------|---------------|
| Toolchain | Use `uv run` for Python commands, `uv add` for dependencies, targeted checks during iteration, and full relevant checks before handoff. | Invoke `/uv` via the Skill tool for dependency changes, lockfiles, or uv failures. |
| Strict typing | Annotate changed public functions, prefer modern builtins, use `Mapping` for read-only params, and use `cast()` only when inference fails. | Invoke `/python-pro` via the Skill tool for complex generics, Protocols, or Python 3.12 typing design. |
| Async/resource safety | Await coroutines, close sessions/resources, avoid unbounded concurrency, avoid shared mutable races, and propagate cancellation unless explicitly handled. | Invoke `/async-python` via the Skill tool for connection pools, background tasks, backpressure, or lifecycle design. |
| Behavioral tests | Add or update tests for changed behavior, error paths, and public interfaces; avoid mock theater that hides DB/exchange schema failures. | Invoke `/tdd` via the Skill tool when test strategy is non-trivial or the plan requires red-green-refactor. |
| Architecture seams | Keep exchanges, wallets, and websites isolated; put reusable shared code in `my_exchanges.core`; avoid one-off abstractions. | Escalate to the user or planning workflow when module boundaries or shared-core placement are unclear. |
| Pre-handoff self-check | Check for silent exceptions, unsafe fallbacks, resource leaks, hardcoded secrets/config, and financially risky behavior before reporting done. | Invoke `/adversarial-review` or `/diagnose` via the Skill tool for suspected logic/security bugs or unknown root causes. |

---

## Critical Rules

### 1. Core Library Imports (MANDATORY — never reimplement)

These wrappers handle TLS impersonation, Cloudflare bypass, Fernet encryption, connection retries, log rotation, and standardized formatting. Custom implementations silently bypass all of it.

```python
# Logging — NEVER import logging or loguru directly
from my_exchanges.core.logger import logger, setup_logger

# HTTP requests — NEVER import requests, httpx, aiohttp, or curl_cffi directly
from my_exchanges.core.requests import request_with_retry

# Database — NEVER import pymongo or motor directly
from my_exchanges.core.db import MongoDBClient

# Async helpers — NEVER use os.getenv, time.sleep, or asyncio.sleep directly
from my_exchanges.core.tasks import getenv, wait, retry

# HTTP session management
from my_exchanges.core.http import SessionManager, http_session_mgr
```

**Forbidden stdlib/third-party imports in business logic:**
- `logging` (use `my_exchanges.core.logger`)
- `requests`, `httpx`, `aiohttp`, `curl_cffi` (use `my_exchanges.core.requests`)
- `pymongo`, `motor` (use `my_exchanges.core.db`)
- `os.getenv` (use `my_exchanges.core.tasks.getenv`)
- `time.sleep`, `asyncio.sleep` (use `my_exchanges.core.tasks.wait`)

### 2. Environment & Workflow

Use the `uv-package-manager` skill only when adding dependencies, resolving lock files, or troubleshooting the uv toolchain.

- **Python interpreter:** `uv run` — never invoke `python`, `pip`, or `pytest` directly
- **Install deps:** `uv add <package>` (never `pip install`)
- **Run tests:** `uv run pytest my_exchanges/tests/`
- **Lint:** `uv run ruff check --fix . && uv run ruff format .`
- **Type check:** `uv run mypy --strict --ignore-missing-imports .`
- **Pre-commit:** `uv run pre-commit run --all-files` (never use `--no-verify`)

### 3. Type Checking (mypy --strict)

Use the `python-pro` skill only when dealing with complex generics, Protocol typing, or modern Python 3.12+ features.

- Python 3.12+ with `from __future__ import annotations`
- `mypy --strict --ignore-missing-imports` is enforced in CI
- Use `| None` instead of `Optional[...]`
- Use `list[str]` instead of `List[str]`
- Use `dict[str, Any]` instead of `Dict[str, Any]`
- Annotate all function signatures, including `self` methods that return `None`
- Use `Mapping[str, Any]` for function parameters that only need read access
- Use `cast()` from `typing` when mypy cannot infer types (common with Motor cursors)

### 4. Pydantic v2 Patterns

All data models use Pydantic v2 with strict validation:

```python
from pydantic import BaseModel, ConfigDict, Field

class MyModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    field_name: str = Field(..., example="value")
    optional_field: str | None = Field(default=None, example="optional")
    numeric_field: float = Field(..., ge=0.0, example=100.0)
```

- `extra="forbid"` on all models to reject unexpected fields
- `validate_assignment=True` to validate on attribute mutation
- `Field(..., example=...)` for every field (used for documentation)
- Use `extra="ignore"` only for external API response models that may have undocumented fields

### 5. Exception Hierarchy

All exchange errors inherit from `ExchangeError`:

```python
from my_exchanges.extensions.exchanges.base.exceptions import (
    ExchangeError,
    RateLimitError,
    AuthenticationError,
    InsufficientFundsError,
    OrderNotFoundError,
)
```

Create new exceptions by subclassing `ExchangeError`. Never raise bare `Exception` in exchange code.

### 6. Async MongoDB (MongoDBClient)

Use the `async-python-patterns` skill only when implementing connection pools, background tasks, or concurrent data access beyond simple `await`.

```python
from my_exchanges.core.db import MongoDBClient

client = MongoDBClient(db_name="codys-private")
await client.connect()

# Read with query timeout (enforced by D-6007)
docs = await client.read_document("APIs", {"service": "binance"})

# Read and auto-decode Fernet-encrypted fields
decoded = await client.read_and_decode_document("APIs", {"service": "binance"})

# Write
await client.create_document("wallets", {"addr": "0x...", "label": "Hot"})
await client.update_document("wallets", {"addr": "0x..."}, {"balance": 100.0})
await client.delete_document("wallets", {"addr": "0x..."})
```

- `MongoDBClient` uses a singleton `AsyncIOMotorClient` for connection pooling
- Always `await client.connect()` before operations (idempotent — safe to call multiple times)
- All queries include `max_time_ms=30000` by default
- Databases: `codys-private` (exchange APIs, wallet data), `codys` (everything else)

### 7. HTTP Requests

Use the `async-python-patterns` skill only when managing complex `AsyncSession` lifecycles, connection pooling, or backpressure with `curl_cffi`.

```python
from curl_cffi.requests import AsyncSession
from my_exchanges.core.requests import request_with_retry

async def fetch_data(session: AsyncSession, url: str) -> Any:
    return await request_with_retry(
        session, url,
        retries=5,
        backoff_factor=1.0,
        retry_status_codes={403, 500, 502, 503, 504}
    )
```

- Use `curl_cffi.requests.AsyncSession` for TLS impersonation
- Always use `request_with_retry` for external API calls
- Default retry status codes: 403, 500, 502, 503, 504
- Set `timeout=10` on session requests unless the endpoint is known to be slow

### 8. Logging

```python
from my_exchanges.core.logger import logger

logger.info("Connecting to {}...", exchange_name)
logger.success("Order placed: {} {}", coin, amount)
logger.warning("Rate limit hit, retrying...")
logger.error("Failed to fetch balance: {}", error)
```

- Use loguru-style brace formatting (`{}`), not f-strings
- Log at appropriate levels: `DEBUG` for verbose internals, `INFO` for flow, `SUCCESS` for completions, `WARNING` for recoverable issues, `ERROR` for failures
- `setup_logger()` configures file rotation (timezone-aware midnight), console output, and tqdm integration

### 9. Testing

Use the `tdd` skill only when test design is non-trivial or the plan calls for red-green-refactor workflow guidance.

- Test files: `my_exchanges/tests/` or `my_exchanges/test/`, pattern `test_*.py`
- Use `pytest-asyncio` with `asyncio_mode = "auto"` (configured in `pyproject.toml`)
- Never mock MongoDB — use `.env.example` variables or a real test database
- Tests must pass with `uv run pytest my_exchanges/tests/`

```python
import pytest

@pytest.mark.asyncio
async def test_get_price():
    exchange = Binance()
    await exchange.init()
    price = await exchange.get_price("BTC")
    assert price > 0
    await exchange.close()
```

### 10. Code Style (ruff)

- Line length: 88
- Target Python: 3.12
- Enabled rules: `E`, `F`, `I`, `UP`, `B`
- Ignored: `E501` (line too long — 88 is the limit, but don't fight it)
- Imports sorted automatically by ruff

### 11. Import Isolation (enforced by import-linter)

Cross-domain imports are forbidden:
- `exchanges` cannot import `wallets` or `websites`
- `wallets` cannot import `exchanges` or `websites`
- `websites` cannot import `exchanges` or `wallets`
- Business logic must not use stdlib `logging`

All shared code lives in `my_exchanges.core`.

### 12. Exchange Base Class Patterns

New exchanges inherit from `Exchanges` in `my_exchanges.extensions.exchanges.base._base`:

```python
from my_exchanges.extensions.exchanges.base._base import Exchanges
from my_exchanges.extensions.exchanges.base.models import (
    ExchangeConfig, FinalMessage, PriceResponse
)

class MyExchange(Exchanges):
    def __init__(self, config: ExchangeConfig | None = None) -> None:
        super().__init__(config)

    async def get_price(self, coin: str, currency: str = "USDT") -> float:
        # implementation
        pass
```

Required overrides: `get_price`, `get_24h_volume`, `get_ohlcv`, `get_orderbook`, `get_balance`, `limit_buy`, `limit_sell`, `market_buy`, `market_sell`

### 13. Configuration

```python
from my_exchanges.core import config

# Access settings
config.mongo.max_retries
config.mongo.query_max_time_ms
config.http.timeout
```

Environment variables loaded from `.env` (prod) or `test/test.env` (test mode).

### 14. Secret Handling

```python
from my_exchanges.core.requests import encode_secret, decode_secret

# Encrypt before storing in MongoDB
encrypted = encode_secret(api_key, passphrase="optional")
# Returns: {"encrypted_key": b"...", "salt": b"..."}

# Decrypt when reading
# MongoDBClient.read_and_decode_document() does this automatically
```

---

## Response Approach

1. **Confirm scope** — follow the approved plan or user request; state any assumption before relying on it.
2. **Inspect targeted files** — identify the involved `my_exchanges/` modules and import-linter boundaries.
3. **Reuse core contracts** — use existing HTTP, logging, DB, config, async, exception, and model patterns.
4. **Implement minimally** — keep changes within scope and avoid unrelated exchange/wallet flows.
5. **Validate deliberately** — run the plan's checks or the smallest relevant `uv run ruff`, `uv run mypy`, and `uv run pytest` commands.
6. **Report evidence for validation** — list changed files, validation results, blockers, assumptions, deviations, and whether the handoff criteria are satisfied so `/claude-code-validator-python` can review it.
7. **Update `prd.md`** only if the change affects documented behavior.

---

## Resources

Read only the resource needed for the current task.

| File | Description | When to Read |
|------|-------------|--------------|
| `resources/mypy-strict-recipes.md` | Common mypy strict errors and before/after fixes | Fixing type errors or changing strict typing patterns |
| `resources/exchange-implementation-template.md` | Exchange class template with required methods, auth patterns, and test fixture | Adding or substantially changing an exchange implementation |
| `resources/mongodb-patterns.md` | CRUD patterns, encrypted field handling, singleton pooling, real MongoDB tests | Working with MongoDB, encrypted fields, or DB-backed tests |

## Example Interactions

- "Add a new REST exchange for Bybit" → Use `Exchanges` base, implement required methods, use `request_with_retry`, inherit exception hierarchy, add Pydantic models, write pytest-asyncio tests
- "Fix mypy error in wallet module" → Check for missing annotations, `Optional` → `| None`, `List` → `list`, missing `self` type hints, incorrect `cast()` usage
- "Add MongoDB query for wallet labels" → Use `MongoDBClient`, `read_document` with `max_time_ms`, consider `read_and_decode_document` for encrypted fields
- "Implement logging for exchange operations" → Import `logger` from `my_exchanges.core.logger`, use brace formatting, appropriate levels
