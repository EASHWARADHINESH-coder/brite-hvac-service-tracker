"""Dashboard aggregates for the home view."""

from datetime import date, timedelta

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
from app.services.material_claim import (
    defective_in_office_claims,
    defective_pending_ticket_ids,
    mr_pending_ticket_ids,
)
from app.services.permissions import has_org_scope, owned_ticket_ids
from app.services.pms_schedule import generate_visit_dates
from app.services.ticket_logic import assign_by_date, assignment_overdue, is_assigned

router = APIRouter(prefix="/dashboard", tags=["dashboard"], dependencies=[Depends(get_current_user)])

_OPEN_CLAIMS = {ClaimStatus.MR_RAISED, ClaimStatus.MATERIAL_RECEIVED, ClaimStatus.AWAITING_REPLENISH}

_OPEN_STATUSES = (TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.REOPENED)

# A breakdown counts as "long pending" once it's been open this many days (locked D8 decision).
LONG_PENDING_DAYS = 7
# How many worst-offender rows each critical-alert card previews.
_ALERT_PREVIEW = 5


def _ageing_buckets(session, today: date) -> dict:
    """Still-open tickets grouped by age since the complaint date."""
    buckets = {"0-2 days": 0, "3-5 days": 0, "5+ days": 0}
    for t in session.exec(select(Ticket).where(Ticket.status.in_(_OPEN_STATUSES))).all():
        age = (today - t.complaint_date).days
        if age <= 2:
            buckets["0-2 days"] += 1
        elif age <= 5:
            buckets["3-5 days"] += 1
        else:
            buckets["5+ days"] += 1
    return buckets


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


def _alerts(session: SessionDep, today: date) -> dict:
    """The four critical categories for the compact dashboard: counts + worst-offender previews.

    Each item is a small ticket brief with the one metric that matters for its category, so the
    UI can shout the number and list who to chase first. All are sorted worst-first.
    """
    customers = {c.id: c for c in session.exec(select(Customer)).all()}
    tickets = session.exec(select(Ticket)).all()

    def _brief(t: Ticket, **extra) -> dict:
        c = customers.get(t.customer_id)
        return {
            "id": t.id, "ticket_no": t.ticket_no,
            "customer_name": c.name if c else None,
            "work_type": t.work_type.value, "status": t.status.value, **extra,
        }

    # 1) Long-pending breakdowns — open Breakdown tickets aged >= LONG_PENDING_DAYS.
    long_pending = []
    for t in tickets:
        if t.work_type == WorkType.BREAKDOWN and t.status in _OPEN_STATUSES:
            age = (today - t.complaint_date).days
            if age >= LONG_PENDING_DAYS:
                long_pending.append(_brief(t, age_days=age))
    long_pending.sort(key=lambda r: r["age_days"], reverse=True)

    # 2) Outstanding payments — Repaired Service tickets with a positive balance.
    outstanding = []
    outstanding_total = 0.0
    for t in tickets:
        if t.total_amount is None:
            continue
        paid = session.exec(
            select(func.coalesce(func.sum(Payment.amount), 0.0)).where(Payment.ticket_id == t.id)
        ).one()
        bal = t.total_amount - float(paid or 0.0)
        if bal > 0.0001:
            outstanding_total += bal
            outstanding.append(_brief(t, balance=round(bal, 2), bill_no=t.bill_no))
    outstanding.sort(key=lambda r: r["balance"], reverse=True)

    # 3) Assignment overdue — logged but unassigned past the 72h SLA.
    overdue = []
    for t in tickets:
        if not is_assigned(t.updates) and assignment_overdue(t.complaint_date, t.updates, today):
            days_over = (today - assign_by_date(t.complaint_date)).days
            overdue.append(_brief(t, days_overdue=days_over))
    overdue.sort(key=lambda r: r["days_overdue"], reverse=True)

    # 4) Defective stock at the office — returned to office, awaiting dispatch to the BSL
    #    warehouse. Per claim (a ticket may have several), oldest waiting first.
    ticket_by_id = {t.id: t for t in tickets}
    returns = []
    for claim in defective_in_office_claims(session):
        t = ticket_by_id.get(claim.ticket_id)
        if not t:
            continue
        waiting = (today - claim.defective_returned_date).days if claim.defective_returned_date else 0
        returns.append(_brief(
            t, claim_no=claim.claim_no, material_name=claim.material_name,
            qty=claim.qty, uom=claim.uom, days_waiting=waiting,
        ))
    returns.sort(key=lambda r: r["days_waiting"], reverse=True)

    return {
        "long_pending_breakdowns": {
            "count": len(long_pending), "items": long_pending[:_ALERT_PREVIEW],
            "threshold_days": LONG_PENDING_DAYS,
        },
        "outstanding_payments": {
            "count": len(outstanding), "total": round(outstanding_total, 2),
            "items": outstanding[:_ALERT_PREVIEW],
        },
        "assignment_overdue": {
            "count": len(overdue), "items": overdue[:_ALERT_PREVIEW],
        },
        "material_returns": {
            "count": len(returns), "items": returns[:_ALERT_PREVIEW],
        },
    }


@router.get("/daily-activity")
def daily_activity(session: SessionDep, user: CurrentUser, days: int = 14) -> dict:
    """Per-day manpower series (closed / people present / backlog / closed-per-person) for the
    dashboard's Daily activity mini-charts. `days` is clamped to a sensible window."""
    if not has_org_scope(user):
        return {"scope": "personal"}
    from app.services import wip as wip_service

    window = max(7, min(days, 30))
    today = date.today()
    start = today - timedelta(days=window - 1)
    return {"scope": "org", **wip_service.daily_activity(session, start, today)}


@router.get("/priority")
def priority(session: SessionDep, user: CurrentUser, limit: int = 8) -> dict:
    """Auto-ranked 'important tickets' for the dashboard — most important first, across all
    work types. Combines the deterministic urgency score with a manual star and a key/VIP
    customer boost. Each item lists why it ranked (badges)."""
    if not has_org_scope(user):
        return {"scope": "personal"}
    from app.services.ai.ranking import rank_open

    ranked = rank_open(session, date.today(), limit=max(1, min(limit, 25)))
    return {
        "scope": "org",
        "items": [
            {
                "id": r.ticket_id, "ticket_no": r.ticket_no, "customer_name": r.customer_name,
                "work_type": r.work_type, "status": r.status, "score": r.score,
                "starred": r.starred, "reasons": r.reasons,
            }
            for r in ranked
        ],
    }


@router.get("/alerts")
def alerts(session: SessionDep, user: CurrentUser) -> dict:
    """Critical-alerts band for the compact dashboard (org-scope only)."""
    if not has_org_scope(user):
        return {"scope": "personal"}
    return {"scope": "org", **_alerts(session, date.today())}


@router.get("/overview")
def overview(session: SessionDep, user: CurrentUser) -> dict:
    today = date.today()
    if has_org_scope(user):
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
            # Material Return KPI: work done, defective unit still owed back to Blue Star.
            "defective_pending": len(defective_pending_ticket_ids(session)),
            # Health strip: breakdowns logged today, and tickets still waiting on BSL material.
            "breakdown_today": session.exec(
                select(func.count()).select_from(Ticket).where(
                    Ticket.work_type == WorkType.BREAKDOWN, Ticket.complaint_date == today
                )
            ).one(),
            "mr_pending": len(mr_pending_ticket_ids(session)),
            # Ageing of still-open tickets by days since the complaint was logged.
            "ageing": _ageing_buckets(session, today),
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


@router.get("/this-week")
def this_week(session: SessionDep, user: CurrentUser) -> dict:
    """Cash position, PMS visits due this week, and breakdowns logged this week."""
    if not has_org_scope(user):
        return {"scope": "personal"}
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    week_end = today + timedelta(days=7)
    customers = {c.id: c.name for c in session.exec(select(Customer)).all()}

    # --- cash ---
    outstanding = 0.0
    for t in session.exec(select(Ticket).where(Ticket.total_amount.is_not(None))).all():
        paid = session.exec(
            select(func.coalesce(func.sum(Payment.amount), 0.0)).where(Payment.ticket_id == t.id)
        ).one()
        bal = t.total_amount - float(paid or 0.0)
        if bal > 0.0001:
            outstanding += bal
    collected_month = session.exec(
        select(func.coalesce(func.sum(Payment.amount), 0.0)).where(
            Payment.paid_date >= today.replace(day=1)
        )
    ).one()

    # --- PMS visits scheduled within the next 7 days, not yet ticketed ---
    linked = {(lk.pms_id, lk.visit_no) for lk in session.exec(select(PMSVisitTicket)).all()}
    pms_visits = []
    for pms in session.exec(select(PMS)).all():
        dates = generate_visit_dates(pms.wo_start_date, pms.schedule, pms.wo_end_date)
        for i, d in enumerate(dates, start=1):
            if today <= d <= week_end and (pms.id, i) not in linked:
                pms_visits.append({
                    "customer": customers.get(pms.customer_id),
                    "wo_number": pms.wo_number,
                    "scheduled_on": d.isoformat(),
                })
    pms_visits.sort(key=lambda r: r["scheduled_on"])

    # --- breakdowns logged this week ---
    breakdowns = [
        {"ticket_no": t.ticket_no, "customer": customers.get(t.customer_id),
         "status": t.status.value, "complaint_date": t.complaint_date.isoformat()}
        for t in session.exec(
            select(Ticket).where(
                Ticket.work_type == WorkType.BREAKDOWN, Ticket.complaint_date >= week_start
            )
        ).all()
    ]
    breakdowns.sort(key=lambda r: r["complaint_date"], reverse=True)

    return {
        "scope": "org",
        "cash": {"outstanding": round(outstanding, 2), "collected_this_month": round(float(collected_month or 0.0), 2)},
        "pms_this_week": pms_visits,
        "breakdown_this_week": breakdowns,
    }
