# Exchange Implementation Template

Complete template for adding a new REST exchange to `my_exchanges`.

## File: `my_exchanges/extensions/exchanges/rest/myexchange.py`

```python
"""MyExchange REST API client."""

from __future__ import annotations

from typing import Any

from curl_cffi.requests import AsyncSession

from my_exchanges.core import config
from my_exchanges.core.logger import logger
from my_exchanges.core.requests import request_with_retry
from my_exchanges.extensions.exchanges.base._base import Exchanges
from my_exchanges.extensions.exchanges.base.exceptions import (
    AuthenticationError,
    ExchangeError,
    InsufficientFundsError,
    RateLimitError,
)
from my_exchanges.extensions.exchanges.base.models import (
    ExchangeConfig,
    FinalMessage,
    OrderbookEntry,
    OrderbookResponse,
    PriceResponse,
    VolumeResponse,
)


class MyExchange(Exchanges):
    """MyExchange REST API implementation."""

    def __init__(self, config: ExchangeConfig | None = None) -> None:
        super().__init__(config)
        self._session: AsyncSession | None = None

    async def init(self) -> None:
        await super().init()
        self._session = AsyncSession(
            impersonate="chrome120",
            timeout=config.http.timeout,
        )

    async def close(self) -> None:
        if self._session:
            await self._session.close()
            self._session = None

    async def __aenter__(self) -> MyExchange:
        await self.init()
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------

    def _gen_signature(self, payload: dict[str, object]) -> str:
        """Generate request signature."""
        if not self.secret_key:
            raise AuthenticationError("Secret key not configured")
        # Implementation specific to exchange
        ...

    # ------------------------------------------------------------------
    # Public endpoints
    # ------------------------------------------------------------------

    async def _http_public(self, endpoint: str, params: dict[str, object] | None = None) -> Any:
        if self._session is None:
            raise ExchangeError("Session not initialized. Call init() first.")

        url = f"{self.endpoint_url}{endpoint}"
        return await request_with_retry(
            self._session, url, retries=5, backoff_factor=1.0
        )

    async def _http_private(
        self,
        endpoint: str,
        method: str = "GET",
        payload: dict[str, object] | None = None,
    ) -> Any:
        if self._session is None:
            raise ExchangeError("Session not initialized. Call init() first.")
        if not self.api_key:
            raise AuthenticationError("API key not configured")

        url = f"{self.endpoint_url}{endpoint}"
        # Add auth headers / signature
        ...

        return await request_with_retry(
            self._session, url, retries=5, backoff_factor=1.0
        )

    # ------------------------------------------------------------------
    # Required overrides
    # ------------------------------------------------------------------

    async def get_price(self, coin: str, currency: str | None = "USDT") -> float:
        """Get current price for a trading pair."""
        ...

    async def get_24h_volume(self, coin: str, currency: str | None = "USDT") -> float:
        """Get 24h trading volume."""
        ...

    async def get_ohlcv(
        self,
        coin: str,
        currency: str | None = "USDT",
        interval: str = "1d",
        limit: int = 100,
    ) -> list[list[float]]:
        """Get OHLCV candlestick data."""
        ...

    async def get_orderbook(
        self,
        coin: str,
        currency: str | None = "USDT",
        limit: int = 10,
    ) -> OrderbookResponse:
        """Get order book bids and asks."""
        ...

    async def get_balance(self, coin: str | None = None) -> dict[str, float]:
        """Get account balance."""
        ...

    async def limit_buy(
        self,
        coin: str,
        amount: float,
        price: float,
        currency: str | None = "USDT",
    ) -> FinalMessage:
        """Place a limit buy order."""
        ...

    async def limit_sell(
        self,
        coin: str,
        amount: float,
        price: float,
        currency: str | None = "USDT",
    ) -> FinalMessage:
        """Place a limit sell order."""
        ...

    async def market_buy(
        self,
        coin: str,
        amount: float,
        currency: str | None = "USDT",
    ) -> FinalMessage:
        """Place a market buy order."""
        ...

    async def market_sell(
        self,
        coin: str,
        amount: float,
        currency: str | None = "USDT",
    ) -> FinalMessage:
        """Place a market sell order."""
        ...

    async def get_order_history(
        self,
        coin: str | None = None,
        currency: str | None = "USDT",
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Get order history."""
        ...
```

## File: `my_exchanges/tests/test_myexchange.py`

```python
"""Tests for MyExchange REST client."""

from __future__ import annotations

import pytest

from my_exchanges.extensions.exchanges.rest.myexchange import MyExchange


@pytest.fixture
async def exchange():
    ex = MyExchange()
    await ex.init()
    yield ex
    await ex.close()


@pytest.mark.asyncio
async def test_get_price(exchange: MyExchange) -> None:
    price = await exchange.get_price("BTC")
    assert isinstance(price, float)
    assert price > 0


@pytest.mark.asyncio
async def test_get_balance(exchange: MyExchange) -> None:
    balances = await exchange.get_balance()
    assert isinstance(balances, dict)
    for coin, amount in balances.items():
        assert isinstance(coin, str)
        assert isinstance(amount, float)
        assert amount >= 0
```

## Checklist

- [ ] Inherit from `Exchanges` base class
- [ ] Use `curl_cffi.requests.AsyncSession` for HTTP
- [ ] Use `request_with_retry` for all external calls
- [ ] Use `my_exchanges.core.logger` for logging (brace formatting)
- [ ] Raise `ExchangeError` subclasses, never bare `Exception`
- [ ] Type-annotate all methods (mypy --strict)
- [ ] Implement all required abstract methods
- [ ] Write pytest-asyncio tests in `my_exchanges/tests/`
- [ ] Run `uv run mypy --strict --ignore-missing-imports .`
- [ ] Run `uv run ruff check --fix . && uv run ruff format .`
- [ ] Run `uv run pytest my_exchanges/tests/`
