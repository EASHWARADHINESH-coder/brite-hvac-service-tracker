"""Daily briefing agent — a proactive operations summary for the service manager.

Gathers the four things that need attention today (deterministically, always accurate):
  * tickets overdue for assignment (past the 72h SLA, still unassigned)
  * closed tickets whose Blue Star MR isn't finished (work done, paperwork pending)
  * PMS visits due but not yet generated
  * Repaired-Service tickets with an outstanding balance
Then the LLM writes a short narrative on top (fallback-first — a templated summary is used when
the LLM is off). Powers /ai/briefing and the MCP `daily_briefing` tool.
"""

from __future__ import annotations

from datetime import date

from sqlmodel import Session, select

from app.core.enums import ClaimStatus, TicketStatus
from app.models.masters import Customer
from app.models.material_claim import MaterialClaim
from app.models.tickets import Ticket
from app.services.ticket_logic import assign_by_date, assignment_overdue, is_assigned

_OPEN_CLAIMS = {
    ClaimStatus.MR_RAISED, ClaimStatus.MATERIAL_RECEIVED, ClaimStatus.AWAITING_REPLENISH,
}


def _gather(session: Session, today: date) -> dict:
    # Lazy import: the pms/payments read handlers pull in FastAPI, so import at call time.
    from app.api.v1 import payments as payments_api
    from app.api.v1 import pms as pms_api

    customers = {c.id: c.name for c in session.exec(select(Customer)).all()}
    open_claim_tids = set(session.exec(
        select(MaterialClaim.ticket_id).where(MaterialClaim.status.in_(_OPEN_CLAIMS))
    ).all())

    overdue: list[dict] = []
    mr_pending_closed: list[dict] = []
    for t in session.exec(select(Ticket)).all():
        if not is_assigned(t.updates) and assignment_overdue(t.complaint_date, t.updates, today):
            overdue.append({
                "ticket_no": t.ticket_no,
                "customer": customers.get(t.customer_id),
                "days_overdue": max(0, (today - assign_by_date(t.complaint_date)).days),
            })
        if t.status == TicketStatus.CLOSED and t.id in open_claim_tids:
            mr_pending_closed.append({
                "ticket_no": t.ticket_no, "customer": customers.get(t.customer_id),
            })

    pms_due = [
        {"wo_number": r.wo_number, "customer": r.customer_name, "visit_date": r.visit_date.isoformat()}
        for r in pms_api.pms_schedule(session) if r.status == "Due"
    ]
    payments_pending = [
        {"ticket_no": r.ticket_no, "customer": r.customer_name, "balance": round(r.balance, 2)}
        for r in payments_api.follow_up(session)
    ]

    return {
        "date": today.isoformat(),
        "overdue_assignments": sorted(overdue, key=lambda x: -x["days_overdue"]),
        "mr_pending_closed": mr_pending_closed,
        "pms_due": pms_due,
        "payments_pending": payments_pending,
    }


def _deterministic_summary(f: dict) -> str:
    n_pay = sum(p["balance"] for p in f["payments_pending"])
    bits = [
        f"{len(f['overdue_assignments'])} overdue for assignment",
        f"{len(f['mr_pending_closed'])} closed with a pending Blue Star MR",
        f"{len(f['pms_due'])} PMS visit(s) due",
        f"{len(f['payments_pending'])} payment(s) pending"
        + (f" (₹{n_pay:,.0f})" if n_pay else ""),
    ]
    return "Today: " + "; ".join(bits) + "."


def _narrate(f: dict) -> str | None:
    """Short LLM narrative from the facts. None when the LLM is unavailable."""
    from app.services.ai.llm import chat, llm_available

    if not llm_available():
        return None
    import json

    reply = chat(
        system=(
            "You are an operations assistant for an HVAC service company. From the JSON facts, "
            "write a concise daily briefing for the service manager (3-5 sentences). Lead with the "
            "most urgent items, name specific ticket numbers/customers where useful, and end with a "
            "one-line priority. Use only the facts given; no preamble."
        ),
        user=json.dumps(f),
        operation="briefing",
    )
    return reply.strip() if reply and reply.strip() else None


def daily_briefing(session: Session, today: date | None = None) -> dict:
    """Build today's briefing: structured facts + a narrative summary."""
    today = today or date.today()
    f = _gather(session, today)
    narrative = _narrate(f)
    return {
        **f,
        "summary": narrative or _deterministic_summary(f),
        "used_llm": narrative is not None,
    }
