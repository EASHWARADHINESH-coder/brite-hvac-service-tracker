"""Draft follow-up messages from live ticket data (fallback-first).

Two kinds:
  * payment_reminder — a polite reminder for a Repaired-Service ticket with an outstanding balance
  * status_update    — a short status note for the customer about their ticket
The facts (amounts, dates, status) always come from the DB; the LLM only phrases them, so it can't
invent numbers. When the LLM is off, a plain templated message is returned. You review before sending.
"""

from __future__ import annotations

from sqlmodel import Session, select

from app.models.masters import Customer
from app.models.payment import Payment
from app.models.tickets import Ticket
from app.services.ticket_logic import primary_complaint_of

_KINDS = ("payment_reminder", "status_update")


def _facts(session: Session, ticket: Ticket) -> dict:
    cust = session.get(Customer, ticket.customer_id)
    paid = session.exec(
        select(Payment).where(Payment.ticket_id == ticket.id)
    ).all()
    paid_total = sum(p.amount for p in paid)
    updates = sorted(ticket.updates, key=lambda u: u.id or 0)
    latest = updates[-1] if updates else None
    return {
        "ticket_no": ticket.ticket_no,
        "customer": cust.name if cust else None,
        "contact_person": cust.contact_person if cust else None,
        "work_type": ticket.work_type.value,
        "complaint": primary_complaint_of(updates),
        "status": ticket.status.value,
        "latest_stage": latest.stage.value if latest else None,
        "latest_date": latest.action_date.isoformat() if latest and latest.action_date else None,
        "total_amount": ticket.total_amount,
        "paid_amount": round(paid_total, 2),
        "balance": round((ticket.total_amount or 0) - paid_total, 2) if ticket.total_amount else None,
    }


def _template(kind: str, f: dict) -> str:
    who = f.get("contact_person") or f.get("customer") or "Sir/Madam"
    if kind == "payment_reminder":
        bal = f.get("balance") or 0
        return (
            f"Dear {who},\n\n"
            f"This is a gentle reminder regarding service ticket {f['ticket_no']}. "
            f"An amount of Rs. {bal:,.0f} is pending against a total of "
            f"Rs. {(f.get('total_amount') or 0):,.0f}. "
            f"Kindly arrange the payment at your convenience.\n\n"
            f"Thank you,\nBrite Air Conditioning"
        )
    return (
        f"Dear {who},\n\n"
        f"Update on your service ticket {f['ticket_no']}"
        + (f" ({f['complaint']})" if f.get("complaint") else "")
        + f": current status is {f['status']}"
        + (f" as of {f['latest_date']}" if f.get("latest_date") else "")
        + ".\n\nWe'll keep you posted.\n\nRegards,\nBrite Air Conditioning"
    )


def draft(session: Session, ticket_id: int, kind: str) -> dict:
    """Return {kind, text, used_llm} for the ticket, or raise ValueError."""
    if kind not in _KINDS:
        raise ValueError(f"kind must be one of {_KINDS}")
    ticket = session.get(Ticket, ticket_id)
    if ticket is None:
        raise ValueError("Ticket not found")
    if kind == "payment_reminder" and not ticket.total_amount:
        raise ValueError("Payment reminders apply only to tickets with a total amount")

    f = _facts(session, ticket)
    llm_text = _llm_draft(kind, f)
    return {
        "kind": kind,
        "text": llm_text or _template(kind, f),
        "used_llm": llm_text is not None,
    }


def _llm_draft(kind: str, f: dict) -> str | None:
    from app.services.ai.llm import chat, llm_available

    if not llm_available():
        return None
    import json

    goal = (
        "a short, polite payment reminder" if kind == "payment_reminder"
        else "a short, friendly status update"
    )
    reply = chat(
        system=(
            f"You write customer messages for an HVAC service company (Brite Air Conditioning) in "
            f"India. Draft {goal} from the JSON facts. Use ONLY those facts — never invent amounts, "
            f"dates or claims. Amounts are Indian Rupees — write them as 'Rs. <amount>' (never $). "
            f"Keep it under 90 words, sign off as Brite Air Conditioning, plain text."
        ),
        user=json.dumps(f),
        operation="followup",
        temperature=0.3,
    )
    return reply.strip() if reply and reply.strip() else None
