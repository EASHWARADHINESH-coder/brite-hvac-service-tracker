"""PMS work orders with auto-generated visit dates.

Scheduled visits (Schedule 1–6) become PMS tickets on a rolling basis: a visit is
"due" once the current month reaches its month. The "Generate due PMS tickets"
action creates a ticket for each due visit that doesn't already have one.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select

from app.api.deps import SessionDep, get_current_user, require_engineer
from app.core.enums import LifecycleStage, TicketStatus, WorkType
from app.models.masters import Customer
from app.models.pms import PMS, PMSVisitTicket
from app.models.tickets import Ticket, TicketUpdate
from app.services.ai import indexing
from app.schemas.pms import (
    GenerateResult,
    PMSCreate,
    PMSRead,
    PMSVisitRow,
    RemoveResult,
)
from app.services.pms_schedule import generate_visit_dates
from app.services.ticket_logic import next_ticket_no

router = APIRouter(prefix="/pms", tags=["pms"], dependencies=[Depends(get_current_user)])

_SCHEDULE_FIELDS = [f"schedule_{i}" for i in range(1, 7)]
_DEFAULT_COMPLAINT = "General Service"


def _apply_auto_schedule(pms: PMS) -> None:
    visits = generate_visit_dates(pms.wo_start_date, pms.schedule, pms.wo_end_date)
    for field, value in zip(_SCHEDULE_FIELDS, visits + [None] * 6):
        setattr(pms, field, value)


def _visits(pms: PMS) -> list[tuple[int, date]]:
    """(visit_no, date) pairs computed from the WO — 1st of month, stepping by interval.

    Computed (not read from the 6 stored columns) so counts above 6 (e.g. 12/year) work.
    visit_no is the 1-based ordinal and is stable for a given WO configuration.
    """
    dates = generate_visit_dates(pms.wo_start_date, pms.schedule, pms.wo_end_date)
    return [(i + 1, d) for i, d in enumerate(dates)]


def _is_due(visit_date: date, today: date) -> bool:
    """A visit is due once its scheduled date is on or before today; later = future."""
    return visit_date <= today


@router.get("", response_model=list[PMSRead])
def list_pms(session: SessionDep, customer_id: int | None = None):
    stmt = select(PMS)
    if customer_id:
        stmt = stmt.where(PMS.customer_id == customer_id)
    return session.exec(stmt.order_by(PMS.wo_number)).all()


@router.post("", response_model=PMSRead, status_code=201, dependencies=[Depends(require_engineer)])
def create_pms(payload: PMSCreate, session: SessionDep):
    if not session.get(Customer, payload.customer_id):
        raise HTTPException(404, "Customer not found")

    pms = PMS(
        customer_id=payload.customer_id,
        wo_number=payload.wo_number,
        wo_start_date=payload.wo_start_date,
        wo_end_date=payload.wo_end_date,
        schedule=payload.schedule,
        complaint=payload.complaint or _DEFAULT_COMPLAINT,
    )
    if payload.auto_generate:
        _apply_auto_schedule(pms)

    session.add(pms)
    session.commit()
    session.refresh(pms)
    indexing.pms_changed(pms.id)
    return pms


@router.get("/schedule", response_model=list[PMSVisitRow])
def pms_schedule(session: SessionDep):
    """Every scheduled visit with its due status, site (customer) and generated ticket."""
    today = date.today()
    customers = {c.id: c.name for c in session.exec(select(Customer)).all()}
    links = {
        (lk.pms_id, lk.visit_no): lk.ticket_id
        for lk in session.exec(select(PMSVisitTicket)).all()
    }
    ticket_nos = {t.id: t.ticket_no for t in session.exec(select(Ticket)).all()}

    rows: list[PMSVisitRow] = []
    for pms in session.exec(select(PMS).order_by(PMS.wo_number)).all():
        for visit_no, d in _visits(pms):
            tid = links.get((pms.id, visit_no))
            if tid is not None:
                status = "Generated"
            elif _is_due(d, today):
                status = "Due"
            else:
                status = "Upcoming"
            rows.append(PMSVisitRow(
                pms_id=pms.id,
                wo_number=pms.wo_number,
                customer_name=customers.get(pms.customer_id),
                visit_no=visit_no,
                visit_date=d,
                status=status,
                ticket_id=tid,
                ticket_no=ticket_nos.get(tid) if tid else None,
            ))
    rows.sort(key=lambda r: r.visit_date)
    return rows


def _create_pms_ticket(session: SessionDep, pms: PMS, visit_date: date) -> Ticket:
    """Create a PMS-type ticket for a scheduled visit (no machine type — site name only)."""
    complaint_name = pms.complaint or _DEFAULT_COMPLAINT

    ticket = Ticket(
        ticket_no=next_ticket_no(session, WorkType.PMS, visit_date),
        customer_id=pms.customer_id,
        complaint_date=visit_date,
        work_type=WorkType.PMS,
        machine_type=None,
        skill=complaint_name,
        status=TicketStatus.OPEN,
    )
    session.add(ticket)
    session.commit()
    session.refresh(ticket)

    session.add(TicketUpdate(
        ticket_id=ticket.id,
        stage=LifecycleStage.LOGGED,
        action_date=visit_date,
        complaints=complaint_name,
        remarks=f"PMS {pms.wo_number} — scheduled visit",
        status=TicketStatus.OPEN,
    ))
    session.commit()
    session.refresh(ticket)
    return ticket


@router.post("/auto-generate", response_model=GenerateResult, dependencies=[Depends(require_engineer)])
def auto_generate(session: SessionDep):
    """Create PMS tickets for every visit dated on/before today that doesn't have one yet.

    Called on PMS page load: picks up all past-due visits (visits after today stay
    scheduled for the future). Idempotent.
    """
    today = date.today()
    existing = {
        (lk.pms_id, lk.visit_no)
        for lk in session.exec(select(PMSVisitTicket)).all()
    }
    created: list[str] = []
    for pms in session.exec(select(PMS)).all():
        for visit_no, d in _visits(pms):
            if (pms.id, visit_no) in existing or not _is_due(d, today):
                continue
            ticket = _create_pms_ticket(session, pms, d)
            session.add(PMSVisitTicket(pms_id=pms.id, visit_no=visit_no, ticket_id=ticket.id))
            session.commit()
            indexing.ticket_changed(ticket.id)
            created.append(ticket.ticket_no)
    return GenerateResult(created=len(created), tickets=created)


@router.post("/remove-generated", response_model=RemoveResult, dependencies=[Depends(require_engineer)])
def remove_generated(session: SessionDep):
    """Delete generated PMS tickets that have no work done (only their Logged row).

    Tickets with real progress (assigned / material pending / closed …) are kept untouched.
    Removing a ticket also drops its visit link, so the visit shows as "Due" again and can be
    generated manually when it's actually needed.
    """
    removed: list[str] = []
    removed_ids: list[int] = []
    kept = 0
    for link in session.exec(select(PMSVisitTicket)).all():
        ticket = session.get(Ticket, link.ticket_id)
        if ticket is None:
            session.delete(link)  # orphaned link
            continue
        untouched = (
            ticket.status == TicketStatus.OPEN
            and len(ticket.updates) <= 1
            and all(u.stage == LifecycleStage.LOGGED for u in ticket.updates)
        )
        if not untouched:
            kept += 1
            continue
        ticket_no = ticket.ticket_no
        removed_ids.append(ticket.id)
        for u in list(ticket.updates):
            session.delete(u)
        session.delete(link)
        session.delete(ticket)
        removed.append(ticket_no)
    session.commit()
    for tid in removed_ids:
        indexing.ticket_deleted(tid)
    return RemoveResult(removed=len(removed), tickets=removed, kept=kept)


@router.get("/{pms_id}", response_model=PMSRead)
def get_pms(pms_id: int, session: SessionDep):
    pms = session.get(PMS, pms_id)
    if not pms:
        raise HTTPException(404, "PMS work order not found")
    return pms


@router.post("/{pms_id}/regenerate", response_model=PMSRead, dependencies=[Depends(require_engineer)])
def regenerate_schedule(pms_id: int, session: SessionDep):
    """Recompute Schedule 1–6 from the current WO start date + frequency."""
    pms = session.get(PMS, pms_id)
    if not pms:
        raise HTTPException(404, "PMS work order not found")
    _apply_auto_schedule(pms)
    session.add(pms)
    session.commit()
    session.refresh(pms)
    indexing.pms_changed(pms.id)
    return pms
