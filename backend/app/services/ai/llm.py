"""Provider-agnostic LLM access with the production cross-cutting concerns wired in.

Chat completions flow through: cache (P3) -> circuit breaker (P8) -> retry (P8) ->
provider failover (P2) -> metrics (P6). Providers are Groq (cloud free tier) or local Ollama,
reached via LangChain chat models. Anything unavailable returns None so callers fall back to
deterministic output — nothing here raises into a request handler.
"""

from __future__ import annotations

import logging

from app.core.config import get_settings
from app.services.ai import cache, metrics
from app.services.ai.reliability import llm_breaker, llm_retry

logger = logging.getLogger(__name__)

_model_cache: dict[tuple, object] = {}


def llm_available() -> bool:
    """Whether the configured provider's chat model can be built right now."""
    return get_chat_model() is not None


def _model_name(provider: str) -> str:
    s = get_settings()
    return s.ollama_model if provider == "ollama" else s.groq_model


def _provider_usable(provider: str) -> bool:
    if provider == "groq":
        return bool(get_settings().groq_api_key)
    return True  # ollama assumed reachable locally


def get_chat_model(*, provider: str | None = None, streaming: bool = False, temperature: float = 0.2):
    """A LangChain chat model for `provider` (default: configured), or None if unusable.

    Imports are lazy so the app runs without langchain installed.
    """
    settings = get_settings()
    if not settings.ai_enabled:
        return None
    prov = provider or settings.ai_provider
    if prov == "groq" and not settings.groq_api_key:
        return None

    key = (prov, streaming, temperature)
    if key in _model_cache:
        return _model_cache[key]

    try:
        if prov == "ollama":
            from langchain_ollama import ChatOllama

            model = ChatOllama(
                model=settings.ollama_model,
                base_url=settings.ollama_base_url,
                temperature=temperature,
            )
        else:
            from langchain_groq import ChatGroq

            model = ChatGroq(
                model=settings.groq_model,
                api_key=settings.groq_api_key,
                temperature=temperature,
                streaming=streaming,
                timeout=settings.ai_timeout_seconds,
            )
    except ImportError:
        logger.warning("LLM provider '%s' packages not installed", prov)
        return None
    except Exception:  # noqa: BLE001
        logger.exception("Failed to build chat model")
        return None

    _model_cache[key] = model
    return model


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
    """Cached, metered, fault-tolerant single-turn completion. None -> use fallback."""
    settings = get_settings()
    if not settings.ai_ready:
        return None

    sys_prompt = system
    if json_mode:
        sys_prompt += "\n\nRespond with a single valid JSON object and nothing else."

    # Cache (P3).
    ckey = cache.make_key("chat", settings.ai_provider, temperature, sys_prompt, user)
    hit = cache.llm_cache.get(ckey)
    if hit is not None:
        with metrics.track(operation, provider=settings.ai_provider,
                           model=_model_name(settings.ai_provider)) as rec:
            rec["cache_hit"] = True
        return hit

    # Circuit breaker (P8): if open, fail fast to the deterministic fallback.
    if llm_breaker.is_open:
        logger.warning("LLM circuit open — skipping call, using fallback")
        return None

    # Provider order: configured first, then the other one on failover (P2).
    providers = [settings.ai_provider]
    if settings.ai_failover:
        other = "ollama" if settings.ai_provider == "groq" else "groq"
        if _provider_usable(other):
            providers.append(other)

    for prov in providers:
        model = get_chat_model(provider=prov, temperature=temperature)
        if model is None:
            continue
        try:
            with metrics.track(operation, provider=prov, model=_model_name(prov)):
                resp = _invoke(model, sys_prompt, user)
            content = getattr(resp, "content", None)
            if isinstance(content, str) and content:
                llm_breaker.record_success()
                cache.llm_cache.set(ckey, content)
                return content
        except Exception as exc:  # noqa: BLE001 — try next provider, else fall back
            logger.warning("LLM provider '%s' failed: %s", prov, exc)

    llm_breaker.record_failure()
    return None
