"""Service-desk chat assistant.

Answers natural-language questions about the workshop's live data. The deterministic path
recognises a handful of common intents (open tickets, overdue assignments, low stock, PMS
due) and answers straight from the DB. When the LLM is configured, the same DB snapshot is
handed to Groq so it can answer free-form questions too — but the numbers come from the
snapshot, so the model reports facts rather than inventing them.

All queries respect the caller's scope: privileged users (Admin / Engineer) see org-wide
figures; task-scoped users (Technician / Helper) see only their own tickets.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlmodel import Session, select

from app.core.enums import TicketStatus
from app.models.tickets import Ticket
from app.models.user import User
from app.services.materials_ledger import stock_levels
from app.services.permissions import is_privileged, owned_ticket_ids
from app.services.ticket_logic import assignment_overdue, is_assigned


@dataclass
class AssistantReply:
    answer: str
    source: str  # "deterministic" | "llm"
    used_llm: bool = False


def _scoped_tickets(session: Session, user: User) -> list[Ticket]:
    tickets = session.exec(select(Ticket)).all()
    if is_privileged(user):
        return tickets
    owned = owned_ticket_ids(session, user)
    return [t for t in tickets if t.id in owned]


def _snapshot(session: Session, user: User, today: date) -> dict:
    """Compact, scope-aware facts used by both the deterministic and LLM paths."""
    tickets = _scoped_tickets(session, user)
    open_count = sum(1 for t in tickets if t.status == TicketStatus.OPEN)
    in_progress = sum(1 for t in tickets if t.status == TicketStatus.IN_PROGRESS)
    reopened = sum(1 for t in tickets if t.status == TicketStatus.REOPENED)
    overdue = sum(
        1 for t in tickets
        if not is_assigned(t.updates) and assignment_overdue(t.complaint_date, t.updates, today)
    )

    low_stock: list[str] = []
    if is_privileged(user):
        for row in stock_levels(session):
            if row["available"] <= 0:
                low_stock.append(f"{row['material_name']} ({row['available']:g} {row['uom']})")

    return {
        "scope": "org" if is_privileged(user) else "personal",
        "total_tickets": len(tickets),
        "open": open_count,
        "in_progress": in_progress,
        "reopened": reopened,
        "assignment_overdue": overdue,
        "out_of_stock": low_stock,
    }


def _deterministic_answer(question: str, snap: dict) -> str | None:
    """Answer a recognised intent from the snapshot, or None if nothing matches."""
    q = question.lower()

    if any(w in q for w in ("overdue", "sla", "not assigned", "unassigned")):
        n = snap["assignment_overdue"]
        return (
            f"{n} ticket(s) are past the 72-hour assignment SLA and still unassigned."
            if n else "No tickets are past the assignment SLA right now."
        )
    if "stock" in q or "material" in q:
        items = snap.get("out_of_stock") or []
        if not is_privileged_scope(snap):
            return "Stock figures are only available to Service Admin / Engineer users."
        return (
            "Out of stock: " + "; ".join(items) if items else "No materials are out of stock."
        )
    if "reopen" in q:
        return f"{snap['reopened']} ticket(s) are currently in the Reopened state."
    if any(w in q for w in ("open", "pending", "how many", "count", "status", "progress")):
        return (
            f"{snap['open']} open, {snap['in_progress']} in progress, "
            f"{snap['reopened']} reopened (out of {snap['total_tickets']} tickets in your scope)."
        )
    return None


def is_privileged_scope(snap: dict) -> bool:
    return snap.get("scope") == "org"


def answer(session: Session, user: User, question: str, today: date | None = None) -> AssistantReply:
    today = today or date.today()
    snap = _snapshot(session, user, today)

    deterministic = _deterministic_answer(question, snap)

    # RAG grounding: retrieve relevant past tickets/customers (best-effort; [] if unavailable).
    from app.services.ai import rag

    context = ""
    if is_privileged(user):  # scope: only privileged users get org-wide retrieval
        hits = rag.retrieve(session, question, k=4)
        if hits:
            context = "\n".join(f"- {h.text}" for h in hits)

    reply = _llm_answer(question, snap, context)
    if reply is not None:
        return AssistantReply(answer=reply, source="llm", used_llm=True)

    if deterministic is not None:
        return AssistantReply(answer=deterministic, source="deterministic")

    return AssistantReply(
        answer=(
            "I can answer questions about open/overdue tickets, reopened jobs, and (for "
            "admins) out-of-stock materials. Try: \"How many overdue tickets?\""
        ),
        source="deterministic",
    )


def _llm_answer(question: str, snap: dict, context: str = "") -> str | None:
    """Free-form answer grounded in the snapshot + retrieved records. None if LLM unavailable."""
    from app.services.ai.llm import chat, llm_available

    if not llm_available():
        return None

    import json

    ctx_block = f"\n\nRelevant records (retrieved):\n{context}" if context else ""
    reply = chat(
        system=(
            "You are the assistant for an HVAC service CRM. Answer the user's question using "
            "ONLY the JSON facts and the retrieved records provided. If they don't cover it, "
            "say so plainly. Be concise (1-3 sentences). Do not invent numbers."
        ),
        user=f"Facts:\n{json.dumps(snap)}{ctx_block}\n\nQuestion: {question}",
        operation="assistant",
    )
    return reply.strip() if reply and reply.strip() else None
