"""Caching layer (Principle 3).

Small, dependency-free in-memory TTL+LRU caches for expensive AI results — LLM answers
and embeddings — so repeat inputs don't re-hit the model. Thread-safe; tracks hit/miss
rate for the monitoring dashboard.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import OrderedDict
from typing import Any


class TTLCache:
    def __init__(self, maxsize: int = 512, ttl: float = 3600.0):
        self.maxsize = maxsize
        self.ttl = ttl
        self._d: "OrderedDict[str, tuple[float, Any]]" = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> Any | None:
        with self._lock:
            item = self._d.get(key)
            if item is None:
                self.misses += 1
                return None
            ts, val = item
            if time.time() - ts > self.ttl:
                del self._d[key]
                self.misses += 1
                return None
            self._d.move_to_end(key)
            self.hits += 1
            return val

    def set(self, key: str, val: Any) -> None:
        with self._lock:
            self._d[key] = (time.time(), val)
            self._d.move_to_end(key)
            while len(self._d) > self.maxsize:
                self._d.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._d.clear()

    def stats(self) -> dict:
        total = self.hits + self.misses
        return {
            "size": len(self._d),
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": round(self.hits / total, 3) if total else 0.0,
        }


def make_key(*parts: Any) -> str:
    """Stable cache key from arbitrary JSON-able parts."""
    return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()


# Shared caches. LLM answers are short-lived (data changes); embeddings live longer.
llm_cache = TTLCache(maxsize=256, ttl=1800)     # 30 min
embed_cache = TTLCache(maxsize=4096, ttl=86400)  # 24 h


def all_stats() -> dict:
    return {"llm": llm_cache.stats(), "embeddings": embed_cache.stats()}
