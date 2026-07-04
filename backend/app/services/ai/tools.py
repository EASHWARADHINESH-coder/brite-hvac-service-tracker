"""LangChain tools the agent can call, bound to a request's DB session + user.

Read tools answer questions from live data and always respect the caller's role scope
(privileged users see org-wide data; task-scoped users see only their own tickets). The one
write tool, `propose_create_ticket`, is *guarded*: it never mutates — it validates inputs and
records a structured proposal that the user must explicitly confirm (see services.ai.actions).
Building the tools lazily keeps langchain an optional dependency.
"""

from __future__ import annotations

from datetime import date

from sqlmodel import select

from app.core.enums import MachineType, TicketStatus, WorkType
from app.models.masters import Complaint, Customer
from app.models.tickets import Ticket
from app.models.user import User
from app.services.ai import ranking
from app.services.materials_ledger import stock_levels
from app.services.permissions import is_privileged, owned_ticket_ids
from app.services.ticket_logic import assignment_overdue, is_assigned, primary_complaint_of


def build_tools(session, user: User, proposals: list[dict]):
    """Return the LangChain tools for this request. `proposals` collects guarded writes.

    Returns [] if langchain isn't installed, so the caller can degrade to the non-agent path.
    """
    try:
        from langchain_core.tools import tool
    except ImportError:
        return []

    today = date.today()

    def _scoped_tickets() -> list[Ticket]:
        tickets = session.exec(select(Ticket)).all()
        if is_privileged(user):
            return tickets
        owned = owned_ticket_ids(session, user)
        return [t for t in tickets if t.id in owned]

    @tool
    def ticket_stats() -> str:
        """Counts of tickets by status (open, in progress, closed, reopened) in the user's scope."""
        tickets = _scoped_tickets()
        counts = {s.value: 0 for s in TicketStatus}
        for t in tickets:
            counts[t.status.value] += 1
        return f"Total {len(tickets)} ticket(s) in scope: " + ", ".join(
            f"{k}: {v}" for k, v in counts.items()
        )

    @tool
    def overdue_tickets() -> str:
        """List tickets past the 72-hour assignment SLA that are still unassigned."""
        rows = [
            t for t in _scoped_tickets()
            if not is_assigned(t.updates) and assignment_overdue(t.complaint_date, t.updates, today)
        ]
        if not rows:
            return "No tickets are past the assignment SLA."
        return "Overdue (unassigned past 72h): " + "; ".join(
            f"{t.ticket_no} ({t.complaint_date.isoformat()})" for t in rows
        )

    @tool
    def rank_unassigned_tickets() -> str:
        """Rank unassigned tickets by allocation urgency (SLA, work type, severity, age). Privileged only."""
        if not is_privileged(user):
            return "Only Service Admin / Engineer can rank tickets for allocation."
        ranked = ranking.rank_unassigned(session, today=today, limit=10)
        if not ranked:
            return "No unassigned tickets to rank."
        return "; ".join(f"{r.ticket_no} score {r.score} ({', '.join(r.reasons)})" for r in ranked)

    @tool
    def material_stock() -> str:
        """Current stock levels per material (available quantity). Privileged only."""
        if not is_privileged(user):
            return "Stock figures are only available to Service Admin / Engineer users."
        rows = stock_levels(session)
        if not rows:
            return "No materials on record."
        return "; ".join(f"{r['material_name']}: {r['available']:g} {r['uom']}" for r in rows)

    @tool
    def search_tickets(term: str) -> str:
        """Find tickets by ticket number fragment or customer name (case-insensitive)."""
        term_l = term.lower().strip()
        customers = {c.id: c.name for c in session.exec(select(Customer)).all()}
        hits = [
            t for t in _scoped_tickets()
            if term_l in t.ticket_no.lower()
            or term_l in (customers.get(t.customer_id) or "").lower()
        ]
        if not hits:
            return f"No tickets match '{term}'."
        return "; ".join(
            f"{t.ticket_no} — {customers.get(t.customer_id) or '?'} "
            f"[{t.work_type.value}, {t.status.value}, complaint: {primary_complaint_of(t.updates) or '-'}]"
            for t in hits[:15]
        )

    @tool
    def propose_create_ticket(
        customer_name: str,
        work_type: str,
        complaint_date: str,
        machine_type: str = "",
        primary_complaint: str = "",
        remarks: str = "",
    ) -> str:
        """Propose creating a new service ticket. Does NOT create it — records a proposal the
        user must confirm. work_type is one of Breakdown/Service/Repaired Service/PMS;
        complaint_date is YYYY-MM-DD; machine_type is one of VRF/Ductable/Package/Chiller/
        Split/Cassette/AHU (omit for PMS). Only Service Admin / Engineer may create tickets."""
        if not is_privileged(user):
            return "You don't have permission to create tickets (Service Admin / Engineer only)."

        customer = session.exec(
            select(Customer).where(Customer.name.ilike(f"%{customer_name}%"))
        ).first()
        if not customer:
            return f"No customer matches '{customer_name}'. Ask the user to pick an existing customer."

        try:
            wt = WorkType(work_type)
        except ValueError:
            return f"Invalid work_type '{work_type}'. Use one of: {', '.join(w.value for w in WorkType)}."

        mt = None
        if machine_type:
            try:
                mt = MachineType(machine_type)
            except ValueError:
                return f"Invalid machine_type '{machine_type}'. Use one of: {', '.join(m.value for m in MachineType)}."

        try:
            date.fromisoformat(complaint_date)
        except ValueError:
            return f"Invalid complaint_date '{complaint_date}'. Use YYYY-MM-DD."

        if primary_complaint:
            known = session.exec(
                select(Complaint).where(Complaint.name == primary_complaint)
            ).first()
            if not known:
                return f"Unknown complaint '{primary_complaint}'. Ask the user to choose a known complaint."

        proposal = {
            "type": "create_ticket",
            "args": {
                "customer_id": customer.id,
                "work_type": wt.value,
                "machine_type": mt.value if mt else None,
                "complaint_date": complaint_date,
                "primary_complaint": primary_complaint or None,
                "remarks": remarks or None,
            },
            "summary": (
                f"Create a {wt.value} ticket for {customer.name}"
                + (f" ({mt.value})" if mt else "")
                + f" dated {complaint_date}"
                + (f", complaint: {primary_complaint}" if primary_complaint else "")
            ),
        }
        proposals.append(proposal)
        return (
            "PROPOSED (not yet created): " + proposal["summary"]
            + ". Tell the user this needs their explicit confirmation to proceed."
        )

    return [
        ticket_stats,
        overdue_tickets,
        rank_unassigned_tickets,
        material_stock,
        search_tickets,
        propose_create_ticket,
    ]
