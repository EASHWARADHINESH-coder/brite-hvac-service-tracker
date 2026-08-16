"""Payment follow-up for Repaired Service tickets.

The ticket carries the agreed total_amount; each Payment reduces the balance.
A ticket is 'fully paid' once payments cover the total. Outstanding tickets show
up on the follow-up list (and get a 'Payment Pending' badge in the UI).
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import func, select

from app.api.deps import SessionDep, get_current_user, require_admin, require_engineer
from app.models.masters import Customer
from app.models.payment import Payment
from app.models.tickets import Ticket
from app.schemas.payment import (
    PaymentCorrection,
    PaymentCreate,
    PaymentFollowUpRow,
    PaymentRead,
    PaymentSummary,
)

router = APIRouter(prefix="/payments", tags=["payments"], dependencies=[Depends(get_current_user)])


def paid_amount(session: SessionDep, ticket_id: int) -> float:
    total = session.exec(
        select(func.coalesce(func.sum(Payment.amount), 0.0)).where(Payment.ticket_id == ticket_id)
    ).one()
    return float(total or 0.0)


@router.get("/follow-up", response_model=list[PaymentFollowUpRow])
def follow_up(session: SessionDep):
    """Repaired Service tickets with an outstanding balance (total set, not fully paid)."""
    names = {c.id: c.name for c in session.exec(select(Customer)).all()}
    rows: list[PaymentFollowUpRow] = []
    tickets = session.exec(
        select(Ticket).where(Ticket.total_amount.is_not(None)).order_by(Ticket.ticket_no.desc())
    ).all()
    for t in tickets:
        paid = paid_amount(session, t.id)
        balance = (t.total_amount or 0.0) - paid
        if balance > 0.0001:
            rows.append(PaymentFollowUpRow(
                ticket_id=t.id, ticket_no=t.ticket_no,
                customer_name=names.get(t.customer_id),
                complaint_date=t.complaint_date,
                total_amount=t.total_amount, paid_amount=paid, balance=balance,
                ticket_status=t.status.value,
                bill_no=t.bill_no, bill_date=t.bill_date,
            ))
    return rows


@router.get("/ticket/{ticket_id}", response_model=PaymentSummary)
def ticket_payments(ticket_id: int, session: SessionDep):
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    customer = session.get(Customer, ticket.customer_id)
    payments = session.exec(
        select(Payment).where(Payment.ticket_id == ticket_id).order_by(Payment.id)
    ).all()
    paid = sum(p.amount for p in payments)
    total = ticket.total_amount
    balance = (total or 0.0) - paid
    return PaymentSummary(
        ticket_id=ticket_id, ticket_no=ticket.ticket_no,
        customer_name=customer.name if customer else None,
        total_amount=total, paid_amount=paid, balance=balance,
        fully_paid=(total is not None and balance <= 0.0001),
        ticket_status=ticket.status.value,
        payments=[PaymentRead(**p.model_dump()) for p in payments],
    )


@router.post("/ticket/{ticket_id}", response_model=PaymentSummary, status_code=201,
             dependencies=[Depends(require_engineer)])
def add_payment(ticket_id: int, payload: PaymentCreate, session: SessionDep):
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if ticket.total_amount is None:
        raise HTTPException(400, "This ticket has no payment total to settle")
    if payload.amount <= 0:
        raise HTTPException(400, "Amount must be greater than 0")

    balance = ticket.total_amount - paid_amount(session, ticket_id)
    if payload.amount > balance + 0.0001:
        raise HTTPException(400, f"Amount exceeds the outstanding balance ({balance:.2f})")

    session.add(Payment(
        ticket_id=ticket_id,
        amount=payload.amount,
        paid_date=payload.paid_date or date.today(),
        remarks=payload.remarks,
    ))
    session.commit()
    return ticket_payments(ticket_id, session)


@router.post("/ticket/{ticket_id}/correction", response_model=PaymentSummary, status_code=201,
             dependencies=[Depends(require_admin)])
def add_correction(ticket_id: int, payload: PaymentCorrection, session: SessionDep):
    """Admin-only signed +/- adjustment to the collected amount, with a required reason.

    A positive correction increases collected (reduces the balance); a negative one reverses
    it. It cannot push total collected below zero.
    """
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if ticket.total_amount is None:
        raise HTTPException(400, "This ticket has no payment total to adjust")
    if not payload.reason or not payload.reason.strip():
        raise HTTPException(400, "A reason is required for a correction")
    if abs(payload.amount) < 0.0001:
        raise HTTPException(400, "Correction amount can't be zero")
    if paid_amount(session, ticket_id) + payload.amount < -0.0001:
        raise HTTPException(400, "A correction can't take total collected below zero")

    session.add(Payment(
        ticket_id=ticket_id,
        amount=payload.amount,
        paid_date=payload.paid_date or date.today(),
        is_correction=True,
        remarks=f"Correction: {payload.reason.strip()}",
    ))
    session.commit()
    return ticket_payments(ticket_id, session)
