# MongoDB Async Patterns

Patterns for working with `MongoDBClient` in `my_exchanges`.

## Basic CRUD

```python
from my_exchanges.core.db import MongoDBClient

client = MongoDBClient(db_name="codys-private")
await client.connect()

# Create
await client.create_document("APIs", {
    "service": "binance",
    "endpoint": "https://api.binance.com",
})

# Read
docs = await client.read_document("APIs", {"service": "binance"})

# Read with sort and limit
docs = await client.read_document(
    "APIs",
    {"service": "binance"},
    sort=[("created_at", -1)],
    limit=10,
)

# Update
await client.update_document(
    "APIs",
    {"service": "binance"},
    {"last_ping": "2024-01-01T00:00:00Z"},
)

# Delete
await client.delete_document("APIs", {"service": "binance"})
```

## Read and Auto-Decode Encrypted Fields

```python
# Documents with encrypted_key/salt are automatically decrypted
decoded = await client.read_and_decode_document(
    "APIs",
    {"service": "binance"},
)
# Returns: [{"service": "binance", "api_key": "plaintext_value", ...}]
```

## Working with Wallet Labels

```python
from my_exchanges.core.db import fetch_labels

labels = await fetch_labels({"entity": "Binance"})
for label in labels:
    print(label["addr"], label["label"])
```

## Singleton Connection Pooling

`MongoDBClient` shares a single `AsyncIOMotorClient` across all instances:

```python
client1 = MongoDBClient(db_name="codys-private")
client2 = MongoDBClient(db_name="codys")

await client1.connect()
await client2.connect()  # Reuses same motor client, different db handle

# Both use the same connection pool
```

## Error Handling

```python
from pymongo import errors

from my_exchanges.core.logger import logger

try:
    await client.create_document("wallets", {"addr": "0x..."})
except errors.DuplicateKeyError:
    logger.warning("Wallet already exists")
except errors.ConnectionFailure:
    logger.error("MongoDB connection lost")
    raise
except errors.PyMongoError as e:
    logger.error(f"Unexpected MongoDB error: {e}")
    raise
```

## Testing with Real MongoDB

```python
import pytest

from my_exchanges.core.db import MongoDBClient
from my_exchanges.core.tasks import getenv


@pytest.fixture
async def db_client():
    client = MongoDBClient(
        db_name="test-my-exchanges",
        host=getenv("MONGO_HOST"),
        port=int(getenv("MONGO_PORT")),
    )
    await client.connect()
    yield client
    # Cleanup
    await client.delete_document("test_collection", {})


@pytest.mark.asyncio
async def test_create_document(db_client: MongoDBClient) -> None:
    doc_id = await db_client.create_document("test_collection", {"key": "value"})
    assert isinstance(doc_id, str)

    docs = await db_client.read_document("test_collection", {"key": "value"})
    assert len(docs) == 1
    assert docs[0]["key"] == "value"
```

## Database Selection Guide

| Database | Collections | Purpose |
|----------|-------------|---------|
| `codys-private` | `APIs`, `wallets` | Exchange credentials, wallet labels, encrypted secrets |
| `codys` | Application-specific | General application data, logs, user data |

## Query Timeout

All `read_document` calls include `max_time_ms=30000` by default (enforced by D-6007). Do not override this without explicit justification.
