from __future__ import annotations

import threading
from pathlib import Path
from typing import Literal

import orderbook as ob
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator


ROOT = Path(__file__).resolve().parent
app = FastAPI(
    title="C++ Matching Engine Demo",
    description="Interactive HTTP demo backed by the C++17 price-time-priority order book.",
    version="1.0.0",
)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

_lock = threading.RLock()
_engine = ob.Engine()
_next_id = 1


class OrderRequest(BaseModel):
    side: Literal["buy", "sell"]
    type: Literal["limit", "market"] = "limit"
    tif: Literal["gtc", "ioc", "fok"] = "gtc"
    price: int = Field(default=0, ge=0)
    quantity: int = Field(gt=0, le=1_000_000_000)

    @model_validator(mode="after")
    def validate_limit_price(self) -> "OrderRequest":
        if self.type == "limit" and self.price <= 0:
            raise ValueError("Limit orders require a price greater than zero.")
        return self


def _seed_demo_book() -> None:
    """Add a small, deterministic spread so the demo is useful on first load."""
    global _next_id
    samples = [
        (ob.Side.Buy, 99, 12),
        (ob.Side.Buy, 98, 20),
        (ob.Side.Buy, 97, 30),
        (ob.Side.Sell, 101, 10),
        (ob.Side.Sell, 102, 18),
        (ob.Side.Sell, 103, 28),
    ]
    for side, price, quantity in samples:
        order = ob.NewOrder(
            id=_next_id,
            side=side,
            type=ob.OrderType.Limit,
            tif=ob.TimeInForce.GTC,
            price=price,
            quantity=quantity,
            timestamp=_next_id,
        )
        _engine.submit(order)
        _next_id += 1


_seed_demo_book()


def _event_json(event: ob.Event) -> dict[str, object]:
    event_type = str(event.type).split(".")[-1].lower()
    result: dict[str, object] = {
        "type": event_type,
        "order_id": event.order_id,
        "price": event.price,
        "quantity": event.quantity,
        "timestamp": event.timestamp,
    }
    if event_type == "fill":
        result["counterparty"] = event.counterparty
    elif event_type == "reject":
        result["reason"] = str(event.reject_reason).split(".")[-1]
    elif event_type == "cancel":
        result["reason"] = str(event.cancel_reason).split(".")[-1]
    return result


def _level_json(level: object) -> dict[str, int]:
    return {"price": level.price, "quantity": level.quantity}


def _book_json(depth: int) -> dict[str, object]:
    bid = _engine.best_bid()
    ask = _engine.best_ask()
    return {
        "best_bid": None if bid is None else {"price": bid.price, "quantity": bid.quantity},
        "best_ask": None if ask is None else {"price": ask.price, "quantity": ask.quantity},
        "bids": [_level_json(level) for level in _engine.bid_depth(depth)],
        "asks": [_level_json(level) for level in _engine.ask_depth(depth)],
    }


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok", "engine": "cpp17"}


@app.get("/api/book", tags=["order book"])
def get_book(depth: int = Query(default=10, ge=1, le=50)) -> dict[str, object]:
    with _lock:
        return _book_json(depth)


@app.post("/api/orders", tags=["orders"])
def submit_order(request: OrderRequest) -> dict[str, object]:
    global _next_id
    with _lock:
        order_id = _next_id
        timestamp = order_id
        _next_id += 1
        order = ob.NewOrder(
            id=order_id,
            side=ob.Side.Buy if request.side == "buy" else ob.Side.Sell,
            type=ob.OrderType.Limit if request.type == "limit" else ob.OrderType.Market,
            tif={
                "gtc": ob.TimeInForce.GTC,
                "ioc": ob.TimeInForce.IOC,
                "fok": ob.TimeInForce.FOK,
            }[request.tif],
            price=request.price,
            quantity=request.quantity,
            timestamp=timestamp,
        )
        events = _engine.submit(order)
        return {
            "order_id": order_id,
            "events": [_event_json(event) for event in events],
            "book": _book_json(10),
        }


@app.delete("/api/orders/{order_id}", tags=["orders"])
def cancel_order(order_id: int) -> dict[str, object]:
    global _next_id
    if order_id < 1:
        raise HTTPException(status_code=422, detail="order_id must be positive")
    with _lock:
        timestamp = _next_id
        _next_id += 1
        events = _engine.cancel(order_id, timestamp)
        return {
            "order_id": order_id,
            "events": [_event_json(event) for event in events],
            "book": _book_json(10),
        }
