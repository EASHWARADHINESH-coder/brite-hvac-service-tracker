"""Core deterministic business logic shared by the API layer.

Implements the three rules that must stay consistent everywhere:
  * ticket-number generation (continuous per-day running number across all work types)
  * skill derivation ("<Complaint Type> - <Machine Type>")
  * status auto-rule (end date present ⇒ Closed)
"""

from datetime import date, timedelta

from sqlmodel import Session, func, select

from app.core.enums import (
    ASSIGNMENT_SLA_HOURS,
    TC_TRIGGER_COMPLAINTS,
    WORK_TYPE_PREFIX,
    LifecycleStage,
    MachineType,
    TicketStatus,
    WorkType,
)
from app.models.tickets import Ticket, TicketUpdate

# Stages that mean the ticket has been assigned (or progressed past assignment).
_ASSIGNED_OR_LATER = {
    LifecycleStage.ASSIGNED,
    LifecycleStage.WORK_STARTED,
    LifecycleStage.MATERIAL_PENDING,
    LifecycleStage.TESTING_COMMISSIONING,
    LifecycleStage.CLOSED,
    # deprecated stages also imply the ticket left the Logged state
    LifecycleStage.DIAGNOSED,
    LifecycleStage.PARTS_REQUESTED,
    LifecycleStage.REPAIR_IN_PROGRESS,
}


def next_ticket_no(session: Session, work_type: WorkType, on_date: date) -> str:
    """PREFIX + YYYYMMDD + 2-digit running number, continuous across work types per day.

    e.g. first ticket of 2026-06-13 → B2026061301, next (any work type) → ...02.
    """
    prefix = WORK_TYPE_PREFIX[work_type]
    datestr = on_date.strftime("%Y%m%d")

    # Count tickets already created for this calendar date (across every prefix).
    count = session.exec(
        select(func.count())
        .select_from(Ticket)
        .where(func.substr(Ticket.ticket_no, 2, 8) == datestr)
    ).one()

    running = count + 1
    return f"{prefix}{datestr}{running:02d}"


def derive_skill(complaint_type: str, machine_type: MachineType) -> str:
    """"<Complaint Type> - <Machine Type>", e.g. 'Major Breakdown - VRF'."""
    return f"{complaint_type} - {machine_type.value}"


def resolve_status(end_date: date | None, reopen: bool = False) -> TicketStatus:
    """Excel auto-rule: end date present ⇒ Closed; reopened flag wins when set."""
    if reopen and end_date is None:
        return TicketStatus.REOPENED
    if end_date is not None:
        return TicketStatus.CLOSED
    return TicketStatus.OPEN


def compute_ticket_status(updates: list[TicketUpdate]) -> TicketStatus:
    """Derive the ticket's current status from its lifecycle chain (latest update wins).

    Open      — only the initial Logged entry, no work started.
    In Progress — work under way (a stage past Logged, no end date).
    Closed    — latest update has an end date.
    Reopened  — latest update is a reopen with no end date yet.
    """
    if not updates:
        return TicketStatus.OPEN
    latest = max(updates, key=lambda u: (u.id or 0))
    if latest.reopen and latest.end_date is None:
        return TicketStatus.REOPENED
    if latest.end_date is not None:
        return TicketStatus.CLOSED
    if len(updates) > 1 or latest.stage != LifecycleStage.LOGGED:
        return TicketStatus.IN_PROGRESS
    return TicketStatus.OPEN


def is_assigned(updates: list[TicketUpdate]) -> bool:
    """True once the ticket has an Assigned (or later) lifecycle row."""
    return any(u.stage in _ASSIGNED_OR_LATER for u in updates)


def assign_by_date(complaint_date: date) -> date:
    """Latest date by which a logged ticket should be assigned (72h SLA)."""
    return complaint_date + timedelta(hours=ASSIGNMENT_SLA_HOURS)


def assignment_overdue(
    complaint_date: date, updates: list[TicketUpdate], today: date | None = None
) -> bool:
    """Logged but not yet assigned, and past the 72h assignment window."""
    if is_assigned(updates):
        return False
    today = today or date.today()
    return today > assign_by_date(complaint_date)


def primary_complaint_of(updates: list[TicketUpdate]) -> str | None:
    """The complaint recorded on the initial Logged row, if any."""
    logged = next(
        (u for u in sorted(updates, key=lambda u: u.id or 0)
         if u.stage == LifecycleStage.LOGGED),
        None,
    )
    return logged.complaints if logged else None


def requires_tc(updates: list[TicketUpdate]) -> bool:
    """Whether Testing & Commissioning should be auto-suggested for this ticket."""
    complaint = primary_complaint_of(updates)
    return complaint in TC_TRIGGER_COMPLAINTS if complaint else False
