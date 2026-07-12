"""Provider-agnostic LLM access with the production cross-cutting concerns wired in.

Chat completions flow through: cache (P3) -> circuit breaker (P8) -> retry (P8) ->
multi-model + provider failover (P2) -> metrics (P6). The failover order is an ordered chain
of local Ollama models (primary then fallbacks, e.g. llama3.2 -> qwen2.5 -> gemma2), optionally
ending at Groq. Models that aren't pulled are skipped. Anything unavailable returns None so
callers fall back to deterministic output — nothing here raises into a request handler.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.request

from app.core.config import get_settings
from app.services.ai import cache, metrics
from app.services.ai.reliability import llm_breaker, llm_retry

logger = logging.getLogger(__name__)

_model_cache: dict[tuple, object] = {}
_tags_cache: dict[str, object] = {"ts": 0.0, "models": set()}


def _ollama_models_available() -> set[str]:
    """Ollama tags (pulled models), cached 60s so we don't probe on every call."""
    now = time.time()
    if now - float(_tags_cache["ts"]) < 60 and _tags_cache["models"]:
        return _tags_cache["models"]  # type: ignore[return-value]
    models: set[str] = set()
    try:
        s = get_settings()
        req = urllib.request.Request(s.ollama_base_url.rstrip("/") + "/api/tags")
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.load(r)
        models = {m["name"] for m in data.get("models", [])}
    except Exception:  # noqa: BLE001 — Ollama down -> no local models available
        pass
    _tags_cache.update(ts=now, models=models)
    return models


def provider_model_chain() -> list[tuple[str, str]]:
    """Ordered (provider, model) attempts: available local models, then optional Groq."""
    s = get_settings()
    if not s.ai_enabled:
        return []

    chain: list[tuple[str, str]] = []
    if s.ai_provider == "ollama":
        available = _ollama_models_available()
        chain += [("ollama", m) for m in s.ollama_model_chain if not available or m in available]
        if s.ai_cloud_failover and s.groq_api_key:
            chain.append(("groq", s.groq_model))
    else:  # groq primary
        if s.groq_api_key:
            chain.append(("groq", s.groq_model))
        if s.ai_cloud_failover:  # here "failover" means fall back to local
            available = _ollama_models_available()
            chain += [("ollama", m) for m in s.ollama_model_chain if not available or m in available]
    return chain


def get_chat_model(*, provider: str | None = None, model: str | None = None,
                   streaming: bool = False, temperature: float = 0.2):
    """A LangChain chat model for (provider, model), or None if unusable. Lazy imports."""
    settings = get_settings()
    if not settings.ai_enabled:
        return None
    prov = provider or settings.ai_provider
    if prov == "groq" and not settings.groq_api_key:
        return None
    mdl = model or (settings.ollama_model if prov == "ollama" else settings.groq_model)

    key = (prov, mdl, streaming, temperature)
    if key in _model_cache:
        return _model_cache[key]

    try:
        if prov == "ollama":
            from langchain_ollama import ChatOllama

            built = ChatOllama(
                model=mdl, base_url=settings.ollama_base_url, temperature=temperature
            )
        else:
            from langchain_groq import ChatGroq

            built = ChatGroq(
                model=mdl, api_key=settings.groq_api_key, temperature=temperature,
                streaming=streaming, timeout=settings.ai_timeout_seconds,
            )
    except ImportError:
        logger.warning("LLM provider '%s' packages not installed", prov)
        return None
    except Exception:  # noqa: BLE001
        logger.exception("Failed to build chat model")
        return None

    _model_cache[key] = built
    return built


def first_available_chat_model(*, streaming: bool = False, temperature: float = 0.2):
    """The chat model for the first entry in the failover chain (used by the agent)."""
    for prov, mdl in provider_model_chain():
        m = get_chat_model(provider=prov, model=mdl, streaming=streaming, temperature=temperature)
        if m is not None:
            return m
    return None


def llm_available() -> bool:
    """Whether at least one model in the failover chain can be built right now."""
    return first_available_chat_model() is not None


@llm_retry
def _invoke(model, sys_prompt: str, user: str):
    return model.invoke([("system", sys_prompt), ("human", user)])


def chat(
    system: str,
    user: str,
    *,
    temperature: float = 0.2,
    max_tokens: int = 1024,  # noqa: ARG001 — kept for call-site compatibility
    json_mode: bool = False,
    operation: str = "chat",
) -> str | None:
    """Cached, metered, fault-tolerant completion that walks the model chain. None -> fallback."""
    settings = get_settings()
    if not settings.ai_enabled:
        return None

    sys_prompt = system
    if json_mode:
        sys_prompt += "\n\nRespond with a single valid JSON object and nothing else."

    # Cache (P3) — keyed on the prompt, independent of which model answers.
    ckey = cache.make_key("chat", temperature, sys_prompt, user)
    hit = cache.llm_cache.get(ckey)
    if hit is not None:
        with metrics.track(operation, provider="cache") as rec:
            rec["cache_hit"] = True
        return hit

    # Circuit breaker (P8): if open, fail fast to the deterministic fallback.
    if llm_breaker.is_open:
        logger.warning("LLM circuit open — using fallback")
        return None

    # Walk the failover chain (P2): local models in order, then optional Groq.
    for prov, mdl in provider_model_chain():
        model = get_chat_model(provider=prov, model=mdl, temperature=temperature)
        if model is None:
            continue
        try:
            with metrics.track(operation, provider=prov, model=mdl):
                resp = _invoke(model, sys_prompt, user)
            content = getattr(resp, "content", None)
            if isinstance(content, str) and content:
                llm_breaker.record_success()
                cache.llm_cache.set(ckey, content)
                return content
        except Exception as exc:  # noqa: BLE001 — try next model, else fall back
            logger.warning("model %s/%s failed: %s", prov, mdl, exc)

    llm_breaker.record_failure()
    return None
