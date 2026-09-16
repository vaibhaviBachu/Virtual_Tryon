"""
Milestone 4's GeometryTryOnEngine. Importing this package registers the engine under
the name "geometry" (ai/engines/registry.py's `register_engine`) — this is the same
extensibility mechanism docs/architecture.md §7 describes: a future GenerativeTryOnEngine
or HybridTryOnEngine registers itself the same way, and neither the worker nor the API
needs to change to add it.
"""
from ai.engines.geometry.engine import GeometryTryOnEngine
from ai.engines.registry import register_engine

register_engine("geometry", GeometryTryOnEngine())

__all__ = ["GeometryTryOnEngine"]
