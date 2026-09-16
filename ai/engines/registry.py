"""
Engine registry: maps an engine name (string, stored in DB / config) to a TryOnEngine
instance. This is the "config value, never an if/else on model name" mechanism referred
to in docs/architecture.md §7 — adding GeometryTryOnEngine in Milestone 4 is a
`register_engine("geometry", GeometryTryOnEngine())` call, not a change anywhere else.
"""
from typing import Dict

from ai.engines.base import TryOnEngine
from ai.engines.not_implemented import NotImplementedEngine

_registry: Dict[str, TryOnEngine] = {
    "not_implemented": NotImplementedEngine(),
}


def register_engine(name: str, engine: TryOnEngine) -> None:
    _registry[name] = engine


def get_engine(name: str = "not_implemented") -> TryOnEngine:
    try:
        return _registry[name]
    except KeyError as exc:
        raise ValueError(
            f"No try-on engine registered under name {name!r}. "
            f"Registered engines: {sorted(_registry.keys())}"
        ) from exc
