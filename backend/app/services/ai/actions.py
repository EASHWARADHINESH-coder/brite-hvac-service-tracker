"""Execution of guarded agent proposals, after the user explicitly confirms.

The agent can only *propose* writes (see tools.propose_create_ticket). Actual mutation
happens here, and only here — re-validated and re-authorized server-side, then delegated to
the same business logic the REST API uses (never a parallel implementation). This keeps the
LLM strictly out of the write path: it can suggest, the user confirms, the server enforces.
"""

from __future__ import annotations

from app.models.user import User
from app.schemas.tickets import TicketCreate
from app.services.permissions import is_privileged


class ActionError(Exception):
    """Raised when a proposal is invalid or the user isn't allowed to run it."""


def execute_proposal(session, user: User, proposal: dict) -> dict:
    """Execute a confirmed proposal and return a result summary. Raises ActionError on refusal."""
    if not isinstance(proposal, dict):
        raise ActionError("Malformed proposal.")
    ptype = proposal.get("type")

    if ptype == "create_ticket":
        return _execute_create_ticket(session, user, proposal.get("args") or {})

    raise ActionError(f"Unsupported action '{ptype}'.")


def _execute_create_ticket(session, user: User, args: dict) -> dict:
    # Same guard as the REST endpoint's require_engineer.
    if not is_privileged(user):
        raise ActionError("Only Service Admin / Engineer can create tickets.")

    from datetime import date

    # Import here to avoid a circular import at module load (tickets.py -> services).
    from app.api.v1.tickets import create_ticket as create_ticket_endpoint

    try:
        payload = TicketCreate(
            customer_id=args["customer_id"],
            complaint_date=date.fromisoformat(args["complaint_date"]),
            work_type=args["work_type"],
            machine_type=args.get("machine_type"),
            primary_complaint=args.get("primary_complaint"),
            remarks=args.get("remarks"),
        )
    except (KeyError, ValueError, TypeError) as exc:
        raise ActionError(f"Invalid ticket details: {exc}") from exc

    # Reuse the endpoint's business logic (numbering, skill derivation, validation, seeding).
    # It raises HTTPException on validation errors; surface those as ActionError.
    from fastapi import HTTPException

    try:
        detail = create_ticket_endpoint(payload, session)
    except HTTPException as exc:
        raise ActionError(str(exc.detail)) from exc

    return {
        "action": "create_ticket",
        "ticket_id": detail.id,
        "ticket_no": detail.ticket_no,
        "message": f"Created ticket {detail.ticket_no} for {detail.customer_name or 'customer'}.",
    }
