"""AMC material claims — Blue Star Ltd warranty replacement lifecycle."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select

from app.api.deps import SessionDep, get_current_user, require_engineer
from app.core.enums import ClaimStatus
from app.models.material_claim import MaterialClaim
from app.models.masters import TeamMember
from app.models.tickets import Ticket
from app.models.user import User
from app.schemas.material_claim import (
    ClaimCreate,
    ClaimRead,
    ClaimUpdate,
    DefectiveStockRow,
)
from app.services.material_claim import compute_claim_status, next_claim_no

router = APIRouter(prefix="/claims", tags=["claims"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=list[ClaimRead])
def list_claims(
    session: SessionDep,
    ticket_id: int | None = None,
    status: ClaimStatus | None = None,
):
    stmt = select(MaterialClaim)
    if ticket_id:
        stmt = stmt.where(MaterialClaim.ticket_id == ticket_id)
    if status:
        stmt = stmt.where(MaterialClaim.status == status)
    return session.exec(stmt.order_by(MaterialClaim.claim_no.desc())).all()


@router.get("/defective", response_model=list[DefectiveStockRow])
def defective_stock(session: SessionDep):
    """Defective units held at the office (returned, not yet dispatched to BSL)."""
    claims = session.exec(
        select(MaterialClaim)
        .where(MaterialClaim.defective_returned_date.is_not(None))
        .where(MaterialClaim.pod_no.is_(None))
        .order_by(MaterialClaim.claim_no.desc())
    ).all()
    return [
        DefectiveStockRow(
            claim_id=c.id,
            claim_no=c.claim_no,
            ticket_id=c.ticket_id,
            material_name=c.material_name,
            uom=c.uom,
            qty=c.qty,
            defective_returned_date=c.defective_returned_date,
            engineer_user_id=c.engineer_user_id,
            technician_id=c.technician_id,
        )
        for c in claims
    ]


@router.post("", response_model=ClaimRead, status_code=201, dependencies=[Depends(require_engineer)])
def create_claim(payload: ClaimCreate, session: SessionDep):
    ticket = session.get(Ticket, payload.ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if payload.engineer_user_id and not session.get(User, payload.engineer_user_id):
        raise HTTPException(404, "Engineer (user) not found")
    if payload.technician_id and not session.get(TeamMember, payload.technician_id):
        raise HTTPException(404, "Technician (team member) not found")

    mr_date = payload.mr_date or date.today()
    claim = MaterialClaim(
        claim_no=next_claim_no(session, mr_date),
        ticket_id=payload.ticket_id,
        customer_id=ticket.customer_id,
        material_name=payload.material_name,
        uom=payload.uom,
        qty=payload.qty,
        in_stock=payload.in_stock,
        engineer_user_id=payload.engineer_user_id,
        technician_id=payload.technician_id,
        mr_no=payload.mr_no,
        mr_date=mr_date,
        remarks=payload.remarks,
    )
    claim.status = compute_claim_status(claim)
    session.add(claim)
    session.commit()
    session.refresh(claim)
    return claim


@router.get("/{claim_id}", response_model=ClaimRead)
def get_claim(claim_id: int, session: SessionDep):
    claim = session.get(MaterialClaim, claim_id)
    if not claim:
        raise HTTPException(404, "Claim not found")
    return claim


@router.patch("/{claim_id}", response_model=ClaimRead, dependencies=[Depends(require_engineer)])
def update_claim(claim_id: int, payload: ClaimUpdate, session: SessionDep):
    """Record a milestone (received / used / defective returned / dispatched); status recomputed."""
    claim = session.get(MaterialClaim, claim_id)
    if not claim:
        raise HTTPException(404, "Claim not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(claim, key, value)

    claim.status = compute_claim_status(claim)
    session.add(claim)
    session.commit()
    session.refresh(claim)
    return claim
