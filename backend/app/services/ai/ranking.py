"""Auto-allocate ticket ranking.

Ranks Open / unassigned tickets by how urgently they need a team allocated, so a
dispatcher sees the most pressing jobs first. The score is fully deterministic and
explainable; the LLM (when configured) only adds a short natural-language rationale on
top — it never changes the ordering.

Score components (higher = more urgent):
  * assignment overdue (past the 72h SLA)         +50
  * work type          Breakdown +30 · Repaired Service +20 · Service +10 · PMS +5
  * complaint severity Major +20 · Minor +10 · Commissioning +5
  * reopened ticket                                +25
  * age                +2 per day since the complaint date (capped at +30)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlmodel import Session, select

from app.core.enums import ComplaintType, TicketStatus, WorkType
from app.models.masters import Complaint, Customer
from app.models.tickets import Ticket
from app.services.ticket_logic import assignment_overdue, is_assigned, primary_complaint_of

_WORK_TYPE_WEIGHT = {
    WorkType.BREAKDOWN: 30,
    WorkType.REPAIRED_SERVICE: 20,
    WorkType.SERVICE: 10,
    WorkType.PMS: 5,
}

_COMPLAINT_TYPE_WEIGHT = {
    ComplaintType.MAJOR_BREAKDOWN: 20,
    ComplaintType.MINOR_BREAKDOWN: 10,
    ComplaintType.COMMISSIONING: 5,
}

_OVERDUE_BONUS = 50
_REOPEN_BONUS = 25
_AGE_PER_DAY = 2
_AGE_CAP = 30


@dataclass
class RankedTicket:
    ticket_id: int
    ticket_no: str
    customer_name: str | None
    work_type: str
    score: int
    reasons: list[str] = field(default_factory=list)
    rationale: str | None = None  # optional LLM one-liner


def _complaint_types(session: Session) -> dict[str, ComplaintType]:
    return {c.name: c.complaint_type for c in session.exec(select(Complaint)).all()}


def _score(ticket: Ticket, complaint_types: dict[str, ComplaintType], today: date) -> RankedTicket:
    reasons: list[str] = []
    score = 0

    if assignment_overdue(ticket.complaint_date, ticket.updates, today):
        score += _OVERDUE_BONUS
        reasons.append("assignment overdue (72h SLA passed)")

    wt_weight = _WORK_TYPE_WEIGHT.get(ticket.work_type, 0)
    if wt_weight:
        score += wt_weight
        reasons.append(f"{ticket.work_type.value} work type")

    complaint_name = primary_complaint_of(ticket.updates)
    ctype = complaint_types.get(complaint_name) if complaint_name else None
    if ctype:
        score += _COMPLAINT_TYPE_WEIGHT.get(ctype, 0)
        reasons.append(f"{ctype.value} complaint")

    if ticket.reopen or ticket.status == TicketStatus.REOPENED:
        score += _REOPEN_BONUS
        reasons.append("reopened")

    age_days = max(0, (today - ticket.complaint_date).days)
    if age_days:
        age_score = min(age_days * _AGE_PER_DAY, _AGE_CAP)
        score += age_score
        reasons.append(f"{age_days} day(s) old")

    return RankedTicket(
        ticket_id=ticket.id,
        ticket_no=ticket.ticket_no,
        customer_name=None,  # filled in by rank_unassigned
        work_type=ticket.work_type.value,
        score=score,
        reasons=reasons,
    )


def rank_unassigned(session: Session, today: date | None = None, limit: int = 20) -> list[RankedTicket]:
    """Rank tickets awaiting allocation (no Assigned-or-later lifecycle row), most urgent first."""
    today = today or date.today()
    complaint_types = _complaint_types(session)
    customers = {c.id: c.name for c in session.exec(select(Customer)).all()}

    ranked: list[RankedTicket] = []
    for ticket in session.exec(select(Ticket)).all():
        if is_assigned(ticket.updates) or ticket.status == TicketStatus.CLOSED:
            continue
        row = _score(ticket, complaint_types, today)
        row.customer_name = customers.get(ticket.customer_id)
        ranked.append(row)

    ranked.sort(key=lambda r: r.score, reverse=True)
    return ranked[:limit]


def add_rationales(ranked: list[RankedTicket]) -> list[RankedTicket]:
    """Optionally attach a one-line LLM rationale per ticket. No-op if the LLM is unavailable.

    Ordering and scores are never changed here — this is presentation only.
    """
    from app.services.ai.llm import chat, llm_available

    if not llm_available() or not ranked:
        return ranked

    lines = "\n".join(
        f"{r.ticket_no} ({r.customer_name or 'Unknown'}): score {r.score}, "
        f"factors: {', '.join(r.reasons) or 'none'}"
        for r in ranked
    )
    reply = chat(
        system=(
            "You are a dispatcher aide for an HVAC service company. For each ticket you are "
            "given, write ONE short sentence (max 15 words) telling the dispatcher why to "
            "prioritise it. Return a JSON object mapping ticket number to the sentence."
        ),
        user=f"Tickets ranked by urgency:\n{lines}",
        json_mode=True,
    )
    if not reply:
        return ranked

    import json

    try:
        mapping = json.loads(reply)
    except (ValueError, TypeError):
        return ranked

    for r in ranked:
        note = mapping.get(r.ticket_no)
        if isinstance(note, str):
            r.rationale = note.strip()
    return ranked
