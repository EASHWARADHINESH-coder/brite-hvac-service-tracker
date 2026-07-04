"""Dashboard aggregates for the home view."""

from datetime import date

from fastapi import APIRouter, Depends
from sqlmodel import func, select

from app.api.deps import CurrentUser, SessionDep, get_current_user
from app.core.enums import (
    ClaimStatus,
    QueryStatus,
    TaskStatus,
    TicketStatus,
    WorkType,
)
from app.models.masters import Customer
from app.models.material_claim import MaterialClaim
from app.models.payment import Payment
from app.models.pms import PMS, PMSVisitTicket
from app.models.query import Query
from app.models.task import Task
from app.models.tickets import Ticket
from app.services.permissions import is_privileged, owned_ticket_ids
from app.services.pms_schedule import generate_visit_dates
from app.services.ticket_logic import assignment_overdue, is_assigned

router = APIRouter(prefix="/dashboard", tags=["dashboard"], dependencies=[Depends(get_current_user)])

_OPEN_CLAIMS = {ClaimStatus.MR_RAISED, ClaimStatus.MATERIAL_RECEIVED, ClaimStatus.AWAITING_REPLENISH}


@router.get("/summary")
def summary(session: SessionDep) -> dict:
    total = session.exec(select(func.count()).select_from(Ticket)).one()
    by_status = {
        s.value: session.exec(select(func.count()).select_from(Ticket).where(Ticket.status == s)).one()
        for s in TicketStatus
    }
    by_work_type = {
        w.value: session.exec(select(func.count()).select_from(Ticket).where(Ticket.work_type == w)).one()
        for w in WorkType
    }
    customers = session.exec(select(func.count()).select_from(Customer)).one()
    return {
        "total_tickets": total,
        "open": by_status.get(TicketStatus.OPEN.value, 0),
        "in_progress": by_status.get(TicketStatus.IN_PROGRESS.value, 0),
        "closed": by_status.get(TicketStatus.CLOSED.value, 0),
        "reopened": by_status.get(TicketStatus.REOPENED.value, 0),
        "by_status": by_status,
        "by_work_type": by_work_type,
        "customers": customers,
    }


def _status_counts(session: SessionDep, work_type: WorkType | None = None) -> dict:
    out = {}
    for s in TicketStatus:
        stmt = select(func.count()).select_from(Ticket).where(Ticket.status == s)
        if work_type:
            stmt = stmt.where(Ticket.work_type == work_type)
        out[s.value] = session.exec(stmt).one()
    return out


def _contract_counts(session: SessionDep, today: date) -> dict:
    active_wo = set(session.exec(
        select(PMS.customer_id).where(
            PMS.wo_start_date.is_not(None), PMS.wo_start_date <= today,
            PMS.wo_end_date.is_not(None), PMS.wo_end_date >= today,
        )
    ).all())
    counts = {"AMC": 0, "WTY": 0, "NIC": 0}
    for c in session.exec(select(Customer)).all():
        if c.warranty_end_date and c.warranty_end_date >= today and (
            c.warranty_start_date is None or c.warranty_start_date <= today
        ):
            counts["WTY"] += 1
        elif c.id in active_wo:
            counts["AMC"] += 1
        else:
            counts["NIC"] += 1
    return counts


def _attention(session: SessionDep, today: date) -> dict:
    tickets = session.exec(select(Ticket)).all()
    overdue = sum(
        1 for t in tickets
        if not is_assigned(t.updates) and assignment_overdue(t.complaint_date, t.updates, today)
    )

    # Payment pending: Repaired Service tickets with an outstanding balance.
    pay_count = 0
    pay_total = 0.0
    for t in tickets:
        if t.total_amount is None:
            continue
        paid = session.exec(
            select(func.coalesce(func.sum(Payment.amount), 0.0)).where(Payment.ticket_id == t.id)
        ).one()
        bal = t.total_amount - float(paid or 0.0)
        if bal > 0.0001:
            pay_count += 1
            pay_total += bal

    open_queries = session.exec(
        select(func.count()).select_from(Query).where(Query.status == QueryStatus.OPEN)
    ).one()
    open_claims = session.exec(
        select(func.count()).select_from(MaterialClaim).where(MaterialClaim.status.in_(_OPEN_CLAIMS))
    ).one()

    # PMS visits due (on/before today) without a generated ticket.
    linked = {(lk.pms_id, lk.visit_no) for lk in session.exec(select(PMSVisitTicket)).all()}
    pms_due = 0
    for pms in session.exec(select(PMS)).all():
        dates = generate_visit_dates(pms.wo_start_date, pms.schedule, pms.wo_end_date)
        for i, d in enumerate(dates, start=1):
            if d <= today and (pms.id, i) not in linked:
                pms_due += 1

    return {
        "assignment_overdue": overdue,
        "payment_pending_count": pay_count,
        "payment_pending_total": round(pay_total, 2),
        "open_queries": open_queries,
        "open_claims": open_claims,
        "pms_due": pms_due,
    }


@router.get("/overview")
def overview(session: SessionDep, user: CurrentUser) -> dict:
    today = date.today()
    if is_privileged(user):
        return {
            "scope": "org",
            "tickets": _status_counts(session),
            "breakdown_by_status": _status_counts(session, WorkType.BREAKDOWN),
            "by_work_type": {
                w.value: session.exec(
                    select(func.count()).select_from(Ticket).where(Ticket.work_type == w)
                ).one()
                for w in WorkType
            },
            "attention": _attention(session, today),
            "contracts": _contract_counts(session, today),
        }

    # Personal "my work" view for Technician / Helper.
    owned = owned_ticket_ids(session, user)
    my_status = {s.value: 0 for s in TicketStatus}
    if owned:
        for t in session.exec(select(Ticket).where(Ticket.id.in_(owned))).all():
            my_status[t.status.value] += 1
    my_open_tasks = session.exec(
        select(func.count()).select_from(Task)
        .where(Task.assignee_user_id == user.id, Task.status != TaskStatus.DONE)
    ).one()
    my_open_queries = session.exec(
        select(func.count()).select_from(Query)
        .where(Query.raised_by_user_id == user.id, Query.status == QueryStatus.OPEN)
    ).one()
    return {
        "scope": "personal",
        "my_tickets": my_status,
        "my_tickets_total": sum(my_status.values()),
        "my_open_tasks": my_open_tasks,
        "my_open_queries": my_open_queries,
    }
