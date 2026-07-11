"""LangGraph ReAct agent for the assistant, with streaming and a deterministic fallback.

`stream_answer` is an async generator of typed messages:
    {"type": "token", "text": "..."}     incremental final-answer text
    {"type": "proposal", "proposal": {}} a guarded write awaiting user confirmation (0 or 1)
    {"type": "done", "used_llm": bool, "provider": "..."}

When the LLM/langgraph stack is unavailable (not installed, no provider configured, or an
error mid-stream), it degrades to the deterministic assistant answer, streamed word-by-word
so the UI behaves identically. The agent never mutates data — writes go through guarded
proposals (see tools.propose_create_ticket) that the user confirms separately.
"""

from __future__ import annotations

import asyncio
import logging

from app.core.config import get_settings
from app.models.user import User
from app.services.ai import assistant
from app.services.ai.llm import get_chat_model
from app.services.ai.tools import build_tools

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are the assistant for an HVAC service company's CRM. Answer questions about tickets, "
    "overdue jobs, materials stock, and customers by calling the provided tools — never invent "
    "numbers. Be concise and practical.\n\n"
    "To create a ticket you MUST call propose_create_ticket, which only drafts a proposal. Then "
    "clearly tell the user what will be created and that it needs their explicit confirmation — "
    "never claim a ticket was created. If a tool reports missing/invalid input, ask the user for it."
)


def _build_agent(session, user: User, proposals: list[dict]):
    """Construct a LangGraph ReAct agent, or None if the stack/model is unavailable."""
    model = get_chat_model(streaming=True)
    if model is None:
        return None

    tools = build_tools(session, user, proposals)
    if not tools:
        return None

    try:
        from langgraph.prebuilt import create_react_agent
    except Exception:  # noqa: BLE001 — langgraph missing -> deterministic fallback
        logger.exception("Failed to import LangGraph; using deterministic fallback")
        return None

    # The system-prompt kwarg was renamed across langgraph versions: newer releases use
    # `prompt=`, 0.2.x uses `state_modifier=`. Try each so we work on both.
    for kw in ("prompt", "state_modifier"):
        try:
            return create_react_agent(model, tools, **{kw: _SYSTEM_PROMPT})
        except TypeError:
            continue  # this version doesn't accept that kwarg — try the other
        except Exception:  # noqa: BLE001 — real construction failure -> fallback
            logger.exception("Failed to build LangGraph agent; using deterministic fallback")
            return None

    logger.error("create_react_agent: no compatible system-prompt kwarg found")
    return None


async def _stream_fallback(session, user: User, question: str):
    """Yield the deterministic answer as word tokens, then done (no proposals)."""
    reply = assistant.answer(session, user, question)
    for word in reply.answer.split(" "):
        yield {"type": "token", "text": word + " "}
        await asyncio.sleep(0)  # cooperative; keeps the response flushing
    yield {"type": "done", "used_llm": False, "provider": get_settings().ai_provider}


async def stream_answer(session, user: User, question: str):
    """Stream the agent's final-answer tokens (or the deterministic fallback)."""
    proposals: list[dict] = []
    agent = _build_agent(session, user, proposals)

    if agent is None:
        async for msg in _stream_fallback(session, user, question):
            yield msg
        return

    streamed_any = False
    try:
        async for event in agent.astream_events(
            {"messages": [("user", question)]}, version="v2"
        ):
            if event.get("event") != "on_chat_model_stream":
                continue
            chunk = event["data"].get("chunk")
            text = getattr(chunk, "content", "") if chunk is not None else ""
            # Tool-deciding turns emit tool calls with empty content; only real text streams.
            if isinstance(text, str) and text:
                streamed_any = True
                yield {"type": "token", "text": text}
    except Exception:  # noqa: BLE001 — mid-stream failure -> fall back if nothing sent yet
        logger.exception("Agent stream failed")
        if not streamed_any:
            async for msg in _stream_fallback(session, user, question):
                yield msg
            return
        yield {"type": "token", "text": "\n\n(Sorry — the assistant was interrupted.)"}

    for proposal in proposals[:1]:  # surface at most one pending action per turn
        yield {"type": "proposal", "proposal": proposal}

    yield {"type": "done", "used_llm": True, "provider": get_settings().ai_provider}
