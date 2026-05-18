# mypy --strict Recipes

Common mypy strict errors in this codebase and their fixes.

## Missing return type on `__init__`

```python
# WRONG
class MyClass:
    def __init__(self, value: str):
        self.value = value

# RIGHT
class MyClass:
    def __init__(self, value: str) -> None:
        self.value = value
```

## `Optional[T]` instead of `T | None`

```python
# WRONG
from typing import Optional
def find_user(user_id: str) -> Optional[dict[str, Any]]:
    ...

# RIGHT
def find_user(user_id: str) -> dict[str, Any] | None:
    ...
```

## `List` / `Dict` instead of built-in generics

```python
# WRONG
from typing import List, Dict
def process(data: List[Dict[str, Any]]) -> List[str]:
    ...

# RIGHT
def process(data: list[dict[str, Any]]) -> list[str]:
    ...
```

## Untyped `*args` / `**kwargs`

```python
# WRONG
def log_message(*args, **kwargs):
    ...

# RIGHT
def log_message(*args: object, **kwargs: object) -> None:
    ...
```

## Motor cursor type inference

```python
from typing import cast

# WRONG — mypy sees cursor as Any
docs = await cursor.to_list(length=None)

# RIGHT
docs = cast(list[dict[str, Any]], await cursor.to_list(length=None))
```

## Property without return type

```python
# WRONG
@property
def chain(self):
    return self.chains[0] if self.chains else ""

# RIGHT
@property
def chain(self) -> str:
    return self.chains[0] if self.chains else ""
```

## Callable parameter types

```python
from typing import Callable

# WRONG
def register_handler(handler: Callable) -> None:
    ...

# RIGHT
def register_handler(handler: Callable[[str, dict[str, Any]], None]) -> None:
    ...
```

## Async function missing return annotation

```python
# WRONG
async def fetch_price(coin: str):
    return await self.get_price(coin)

# RIGHT
async def fetch_price(self, coin: str) -> float:
    return await self.get_price(coin)
```
