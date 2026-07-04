"""AI layer endpoints (Phase 5).

Thin handlers over app/services/ai. Every endpoint returns a useful result even with the
LLM off — see the service modules for the fallback-first contract.

  GET  /ai/status                     — is the AI enhancement path live?
  GET  /ai/rank-tickets               — urgency-ranked unassigned tickets (Engineer+)
  POST /ai/tickets/{id}/delivery-note — draft a delivery note for a ticket (Engineer+)
  POST /ai/assistant                  — scope-aware Q&A over the live data
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUser, SessionDep, get_current_user, require_engineer
from app.core.config import get_settings
from app.database import engine
from app.models.user import User
from app.schemas.ai import (
    ActionExecuteIn,
    ActionResultOut,
    AIStatus,
    AssistantAsk,
    AssistantReplyOut,
    DeliveryNoteDraftOut,
    RankedTicketOut,
)
from app.services.ai import actions, agent, assistant, delivery_note, ranking
from app.services.ai.actions import ActionError
from app.services.ai.llm import llm_available
from sqlmodel import Session

router = APIRouter(prefix="/ai", tags=["ai"], dependencies=[Depends(get_current_user)])


def _sse(obj: dict) -> str:
    """Frame a message as a Server-Sent Event data line."""
    return f"data: {json.dumps(obj)}\n\n"


@router.get("/status", response_model=AIStatus)
def status():
    settings = get_settings()
    model = settings.ollama_model if settings.ai_provider == "ollama" else settings.groq_model
    return AIStatus(
        enabled=settings.ai_enabled,
        llm_available=llm_available(),
        provider=settings.ai_provider,
        model=model,
    )


@router.get(
    "/rank-tickets",
    response_model=list[RankedTicketOut],
    dependencies=[Depends(require_engineer)],
)
def rank_tickets(session: SessionDep, limit: int = 20, explain: bool = False):
    """Unassigned tickets ranked by allocation urgency. `explain=true` adds LLM rationales."""
    ranked = ranking.rank_unassigned(session, limit=limit)
    if explain:
        ranked = ranking.add_rationales(ranked)
    return ranked


@router.post(
    "/tickets/{ticket_id}/delivery-note",
    response_model=DeliveryNoteDraftOut,
    dependencies=[Depends(require_engineer)],
)
def draft_delivery_note(ticket_id: int, session: SessionDep, enhance: bool = True):
    try:
        return delivery_note.build_draft(session, ticket_id, enhance=enhance)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/assistant", response_model=AssistantReplyOut)
def assistant_ask(payload: AssistantAsk, session: SessionDep, user: CurrentUser):
    """Non-streaming Q&A (deterministic, or a single LLM answer). Kept for simple clients."""
    return assistant.answer(session, user, payload.question)


@router.post("/assistant/stream")
async def assistant_stream(payload: AssistantAsk, user: CurrentUser):
    """Stream the LangGraph agent's final-answer tokens as Server-Sent Events.

    Messages are JSON on the SSE `data:` channel: {"type":"token","text":..},
    an optional {"type":"proposal","proposal":{..}} for a guarded write, then
    {"type":"done",..}. Falls back to the deterministic answer when the LLM is off.
    A fresh DB session is opened for the stream's lifetime (the request-scoped one
    would close before the body finishes streaming).
    """
    user_id = user.id
    question = payload.question

    async def gen():
        with Session(engine) as session:
            u = session.get(User, user_id)
            if u is None:
                yield _sse({"type": "done", "used_llm": False, "provider": get_settings().ai_provider})
                return
            async for msg in agent.stream_answer(session, u, question):
                yield _sse(msg)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/actions/execute",
    response_model=ActionResultOut,
    dependencies=[Depends(require_engineer)],
)
def execute_action(payload: ActionExecuteIn, session: SessionDep, user: CurrentUser):
    """Run a guarded proposal the user has explicitly confirmed (e.g. create a ticket)."""
    try:
        return actions.execute_proposal(session, user, payload.proposal)
    except ActionError as exc:
        raise HTTPException(400, str(exc)) from exc
