"""Provider-agnostic LLM access (Groq cloud free tier or local Ollama).

Both providers are optional and reached through LangChain chat models, so the rest of the
AI layer is provider-neutral. `get_chat_model()` returns a LangChain model (used by the
LangGraph agent) or None; `chat()` is a convenience single-turn helper used by the ranking
and delivery-note enhancers. Anything that can't be satisfied returns None so callers fall
back to deterministic output — nothing here raises into a request handler.
"""

from __future__ import annotations

import logging

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Cache the chat model across calls, keyed by (provider, streaming, temperature).
_model_cache: dict[tuple, object] = {}


def llm_available() -> bool:
    """Whether an LLM call can be attempted (feature on, provider usable, package present)."""
    if not get_settings().ai_ready:
        return False
    return get_chat_model() is not None


def get_chat_model(*, streaming: bool = False, temperature: float = 0.2):
    """A LangChain chat model for the configured provider, or None if unavailable.

    Imports are lazy so the app runs without langchain/langgraph installed.
    """
    settings = get_settings()
    if not settings.ai_ready:
        return None

    key = (settings.ai_provider, streaming, temperature)
    if key in _model_cache:
        return _model_cache[key]

    try:
        if settings.ai_provider == "ollama":
            from langchain_ollama import ChatOllama

            model = ChatOllama(
                model=settings.ollama_model,
                base_url=settings.ollama_base_url,
                temperature=temperature,
            )
        else:  # groq (default)
            from langchain_groq import ChatGroq

            model = ChatGroq(
                model=settings.groq_model,
                api_key=settings.groq_api_key,
                temperature=temperature,
                streaming=streaming,
                timeout=settings.ai_timeout_seconds,
            )
    except ImportError:
        logger.warning(
            "LLM provider '%s' packages not installed; AI enhancements disabled",
            settings.ai_provider,
        )
        return None
    except Exception:  # noqa: BLE001 — bad config etc. -> degrade to fallback
        logger.exception("Failed to build chat model; falling back to deterministic path")
        return None

    _model_cache[key] = model
    return model


def chat(
    system: str,
    user: str,
    *,
    temperature: float = 0.2,
    max_tokens: int = 1024,  # noqa: ARG001 — kept for call-site compatibility
    json_mode: bool = False,
) -> str | None:
    """Single-turn completion. Returns the reply text, or None to signal "use fallback".

    `json_mode` is a best-effort hint (appended to the system prompt) rather than a hard
    provider constraint, so it works uniformly across Groq and Ollama. Callers already guard
    their JSON parsing.
    """
    model = get_chat_model(temperature=temperature)
    if model is None:
        return None

    sys_prompt = system
    if json_mode:
        sys_prompt += "\n\nRespond with a single valid JSON object and nothing else."

    try:
        resp = model.invoke([("system", sys_prompt), ("human", user)])
        content = getattr(resp, "content", None)
        return content if isinstance(content, str) else None
    except Exception:  # noqa: BLE001 — any failure means "degrade to fallback"
        logger.exception("LLM chat call failed; falling back to deterministic result")
        return None
