"""Draft a delivery note for a ticket's allocated materials.

Deterministic path assembles the note from the ticket, its customer, and the material
issues currently allocated to it. When the LLM is configured, it rewrites the same facts
into a cleaner covering note — but the structured line items always come from the DB, so
the LLM can never invent quantities or materials.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlmodel import Session, select

from app.core.enums import IssueStatus
from app.models.masters import Customer
from app.models.material_ledger import MaterialIssue
from app.models.tickets import Ticket


@dataclass
class DraftLine:
    material_name: str
    uom: str
    qty: float


@dataclass
class DeliveryNoteDraft:
    ticket_id: int
    ticket_no: str
    customer_name: str | None
    customer_site: str | None
    issue_date: date
    lines: list[DraftLine] = field(default_factory=list)
    body: str = ""            # rendered covering note (deterministic or LLM-polished)
    llm_enhanced: bool = False


def _gather(session: Session, ticket_id: int) -> tuple[Ticket, Customer | None, list[MaterialIssue]]:
    ticket = session.get(Ticket, ticket_id)
    if ticket is None:
        raise ValueError("Ticket not found")
    customer = session.get(Customer, ticket.customer_id)
    issues = session.exec(
        select(MaterialIssue).where(
            MaterialIssue.ticket_id == ticket_id,
            MaterialIssue.status == IssueStatus.ALLOCATED,
        )
    ).all()
    return ticket, customer, issues


def _deterministic_body(draft: DeliveryNoteDraft) -> str:
    if not draft.lines:
        items = "  (no materials currently allocated)"
    else:
        items = "\n".join(
            f"  {i}. {ln.material_name} — {ln.qty:g} {ln.uom}"
            for i, ln in enumerate(draft.lines, start=1)
        )
    site = draft.customer_site or draft.customer_name or "site"
    return (
        f"DELIVERY NOTE\n"
        f"Ticket: {draft.ticket_no}\n"
        f"Customer: {draft.customer_name or '-'}\n"
        f"Site: {site}\n"
        f"Date: {draft.issue_date.isoformat()}\n\n"
        f"Materials delivered:\n{items}\n\n"
        f"Received the above materials in good condition.\n"
        f"Received by: ____________________    Signature: ____________________"
    )


def build_draft(session: Session, ticket_id: int, enhance: bool = True) -> DeliveryNoteDraft:
    """Build a delivery-note draft; optionally let the LLM polish the covering text."""
    ticket, customer, issues = _gather(session, ticket_id)

    draft = DeliveryNoteDraft(
        ticket_id=ticket.id,
        ticket_no=ticket.ticket_no,
        customer_name=customer.name if customer else None,
        customer_site=next((i.customer_site for i in issues if i.customer_site), None),
        issue_date=date.today(),
        lines=[DraftLine(i.material_name, i.uom, i.qty) for i in issues],
    )
    draft.body = _deterministic_body(draft)

    if enhance:
        _maybe_enhance(draft)
    return draft


def _maybe_enhance(draft: DeliveryNoteDraft) -> None:
    """Rewrite the covering note via the LLM, keeping the same facts. No-op if unavailable."""
    from app.services.ai.llm import chat, llm_available

    if not llm_available():
        return

    reply = chat(
        system=(
            "You rewrite HVAC service delivery notes into a clean, professional covering "
            "note. Use ONLY the facts provided — never add materials, quantities, prices, or "
            "claims. Keep it concise and include a signature line. Return plain text only."
        ),
        user=draft.body,
        temperature=0.3,
    )
    if reply and reply.strip():
        draft.body = reply.strip()
        draft.llm_enhanced = True
