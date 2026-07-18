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

from sqlmodel import Session

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
    BriefingOut,
    DeliveryNoteDraftOut,
    FollowupOut,
    RankedTicketOut,
    RetrievedOut,
)
from app.services.ai import actions, agent, assistant, briefing, delivery_note, followup, jobs, metrics as ai_metrics, ranking, rag, vectorstore
from app.services.ai.actions import ActionError
from app.services.ai.cache import all_stats
from app.services.ai.llm import llm_available, provider_model_chain
from app.services.ai.reliability import llm_breaker
from app.services.ai.security import ai_rate_limiter, guard_prompt
from app.services.permissions import can_view_ticket, is_privileged

router = APIRouter(prefix="/ai", tags=["ai"], dependencies=[Depends(get_current_user)])


def _sse(obj: dict) -> str:
    """Frame a message as a Server-Sent Event data line."""
    return f"data: {json.dumps(obj)}\n\n"


def _rate_limited(user: CurrentUser) -> User:
    """Per-user token-bucket limit on the expensive AI routes (Principle 1/7)."""
    ai_rate_limiter.check(user.id)
    return user


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
    "/tickets/{ticket_id}/draft-followup",
    response_model=FollowupOut,
    dependencies=[Depends(require_engineer), Depends(_rate_limited)],
)
def draft_followup(ticket_id: int, session: SessionDep, kind: str = "status_update"):
    """Draft a customer follow-up (kind = payment_reminder | status_update) from live data."""
    try:
        return followup.draft(session, ticket_id, kind)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


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


@router.get("/briefing", response_model=BriefingOut, dependencies=[Depends(require_engineer)])
def daily_briefing(session: SessionDep):
    """Today's operations briefing: overdue assignments, closed-but-MR-pending, PMS due,
    and payment follow-ups, with a short narrative summary (LLM when available)."""
    return briefing.daily_briefing(session)


@router.post("/assistant", response_model=AssistantReplyOut, dependencies=[Depends(_rate_limited)])
def assistant_ask(payload: AssistantAsk, session: SessionDep, user: CurrentUser):
    """Non-streaming Q&A (deterministic, or a single LLM answer). Kept for simple clients."""
    guard_prompt(payload.question)
    return assistant.answer(session, user, payload.question)


@router.post("/assistant/stream", dependencies=[Depends(_rate_limited)])
async def assistant_stream(payload: AssistantAsk, user: CurrentUser):
    """Stream the LangGraph agent's final-answer tokens as Server-Sent Events.

    Messages are JSON on the SSE `data:` channel: {"type":"token","text":..},
    an optional {"type":"proposal","proposal":{..}} for a guarded write, then
    {"type":"done",..}. Falls back to the deterministic answer when the LLM is off.
    A fresh DB session is opened for the stream's lifetime (the request-scoped one
    would close before the body finishes streaming).
    """
    guard_prompt(payload.question)
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


# ---- Operations & observability (Principles 4, 6) ----
@router.get("/health")
def ai_health():
    """Model-serving + vector-store health and the circuit-breaker state (Principle 4/8)."""
    s = get_settings()
    return {
        "enabled": s.ai_enabled,
        "provider": s.ai_provider,
        "chat_model": s.ollama_model if s.ai_provider == "ollama" else s.groq_model,
        "llm_available": llm_available(),
        "model_chain": [f"{p}:{m}" for p, m in provider_model_chain()],
        "embeddings_model": s.ollama_embed_model,
        "vector_store": vectorstore.vec_available(),
        "indexed_documents": vectorstore.count(),
        "circuit": llm_breaker.state(),
    }


@router.get("/metrics")
def ai_metrics_endpoint(session: SessionDep):
    """AI usage metrics: per-operation latency, error rate, cache hit rate (Principle 6)."""
    data = ai_metrics.summary(session)
    data["cache"] = all_stats()
    data["circuit"] = llm_breaker.state()
    return data


# ---- RAG / semantic search (Principle: the vector layer) ----
@router.get("/search", response_model=list[RetrievedOut], dependencies=[Depends(_rate_limited)])
def ai_search(q: str, session: SessionDep, user: CurrentUser, k: int = 5):
    """Semantic search over indexed tickets/customers. Privileged users only (org-wide scope)."""
    if not is_privileged(user):
        raise HTTPException(403, "Semantic search is available to Service Admin / Engineer only.")
    return [vars(r) for r in rag.retrieve(session, q, k=k)]


@router.get(
    "/tickets/{ticket_id}/similar",
    response_model=list[RetrievedOut],
    dependencies=[Depends(_rate_limited)],
)
def similar_tickets(ticket_id: int, session: SessionDep, user: CurrentUser, k: int = 5):
    """Past tickets most similar to this one (semantic). Respects ticket visibility."""
    if not can_view_ticket(session, user, ticket_id):
        raise HTTPException(403, "Not your task")
    return [vars(r) for r in rag.similar_tickets(session, ticket_id, k=k)]


# ---- Async reindex job (Principle 5) ----
@router.post("/reindex", dependencies=[Depends(require_engineer)])
def reindex():
    """Kick off a background job that (re)embeds all tickets/customers into the vector store."""
    job_id = jobs.enqueue_reindex()
    return {"job_id": job_id, "status": "queued"}


@router.get("/jobs/{job_id}")
def job_status(job_id: int, session: SessionDep):
    job = jobs.get_job(session, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {
        "id": job.id, "kind": job.kind, "status": job.status,
        "detail": job.detail, "created_at": job.created_at, "finished_at": job.finished_at,
    }
