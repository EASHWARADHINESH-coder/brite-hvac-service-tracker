"""Local embeddings via Ollama (free, offline) — the input side of the RAG layer.

Embeddings are always produced locally by Ollama (independent of the chat provider), cached,
and metered. Returns None on any failure so retrieval degrades gracefully to "no results".
"""

from __future__ import annotations

import json
import logging
import urllib.request

from app.core.config import get_settings
from app.services.ai import metrics
from app.services.ai.cache import embed_cache, make_key

logger = logging.getLogger(__name__)


def _ollama_embed(text: str, model: str, base_url: str, timeout: float) -> list[float]:
    req = urllib.request.Request(
        base_url.rstrip("/") + "/api/embeddings",
        data=json.dumps({"model": model, "prompt": text}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)["embedding"]


def embed(text: str) -> list[float] | None:
    """Embed a single string. Cached by (model, text); None on failure."""
    if not text or not text.strip():
        return None
    s = get_settings()
    if not s.ai_enabled:  # AI layer off -> no embeddings, retrieval degrades to empty
        return None
    key = make_key("embed", s.ollama_embed_model, text)
    cached = embed_cache.get(key)
    if cached is not None:
        return cached
    try:
        with metrics.track("embed", provider="ollama", model=s.ollama_embed_model):
            vec = _ollama_embed(text, s.ollama_embed_model, s.ollama_base_url, s.ai_timeout_seconds)
    except Exception:  # noqa: BLE001 — model not pulled / Ollama down -> RAG disabled
        logger.warning("embedding failed (is Ollama running and '%s' pulled?)", s.ollama_embed_model)
        return None
    embed_cache.set(key, vec)
    return vec


def embed_available() -> bool:
    """Whether embeddings can be produced right now (Ollama up + embed model present)."""
    return embed("healthcheck") is not None
