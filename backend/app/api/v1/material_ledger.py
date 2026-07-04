"""Materials ledger: inward → allocate (issue) → delivery note / return, plus stock view."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select

from app.api.deps import SessionDep, get_current_user, require_engineer
from app.core.enums import IssueOutcome, IssueStatus
from app.models.material_ledger import MaterialInward, MaterialIssue
from app.models.tickets import Ticket
from app.schemas.material_ledger import (
    DeliverRequest,
    InwardCreate,
    InwardRead,
    IssueCreate,
    IssueRead,
    StockRow,
)
from app.services.materials_ledger import (
    next_delivery_note_no,
    next_inward_no,
    next_issue_no,
    stock_levels,
)

router = APIRouter(
    prefix="/materials-ledger", tags=["materials-ledger"], dependencies=[Depends(get_current_user)]
)


# ---- Stock ----
@router.get("/stock", response_model=list[StockRow])
def get_stock(session: SessionDep):
    return stock_levels(session)


# ---- Inward ----
@router.get("/inward", response_model=list[InwardRead])
def list_inward(session: SessionDep):
    return session.exec(select(MaterialInward).order_by(MaterialInward.inward_no.desc())).all()


@router.post("/inward", response_model=InwardRead, status_code=201, dependencies=[Depends(require_engineer)])
def create_inward(payload: InwardCreate, session: SessionDep):
    received = payload.received_date or date.today()
    inward = MaterialInward(
        inward_no=next_inward_no(session, received),
        source_type=payload.source_type,
        doc_no=payload.doc_no,
        supplier=payload.supplier,
        material_name=payload.material_name,
        uom=payload.uom,
        qty=payload.qty,
        received_date=received,
    )
    session.add(inward)
    session.commit()
    session.refresh(inward)
    return inward


# ---- Issues / allocation ----
@router.get("/issues", response_model=list[IssueRead])
def list_issues(session: SessionDep, ticket_id: int | None = None):
    stmt = select(MaterialIssue)
    if ticket_id:
        stmt = stmt.where(MaterialIssue.ticket_id == ticket_id)
    return session.exec(stmt.order_by(MaterialIssue.issue_no.desc())).all()


@router.post("/issues", response_model=IssueRead, status_code=201, dependencies=[Depends(require_engineer)])
def allocate(payload: IssueCreate, session: SessionDep):
    if not session.get(Ticket, payload.ticket_id):
        raise HTTPException(404, "Ticket not found")
    if payload.inward_id is not None and not session.get(MaterialInward, payload.inward_id):
        raise HTTPException(404, "Inward lot not found")

    issue_date = payload.issue_date or date.today()
    issue = MaterialIssue(
        issue_no=next_issue_no(session, issue_date),
        inward_id=payload.inward_id,
        ticket_id=payload.ticket_id,
        customer_site=payload.customer_site,
        material_name=payload.material_name,
        uom=payload.uom,
        qty=payload.qty,
        issue_date=issue_date,
        status=IssueStatus.ALLOCATED,
    )
    session.add(issue)
    session.commit()
    session.refresh(issue)
    return issue


@router.post("/issues/{issue_id}/deliver", response_model=IssueRead, dependencies=[Depends(require_engineer)])
def deliver(issue_id: int, payload: DeliverRequest, session: SessionDep):
    """Close an allocation: Used → issue a delivery note; Not Used → return to stock."""
    issue = session.get(MaterialIssue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if issue.status == IssueStatus.CLOSED:
        raise HTTPException(409, "Issue already closed")

    issue.outcome = payload.outcome
    if payload.outcome == IssueOutcome.USED:
        issue.delivery_note_no = next_delivery_note_no(session, date.today())
    issue.status = IssueStatus.CLOSED

    session.add(issue)
    session.commit()
    session.refresh(issue)
    return issue
