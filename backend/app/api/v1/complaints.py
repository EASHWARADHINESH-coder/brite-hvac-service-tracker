from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select

from app.api.deps import SessionDep, get_current_user, require_admin
from app.models.masters import Complaint
from app.schemas.masters import ComplaintCreate, ComplaintRead

router = APIRouter(
    prefix="/complaints", tags=["complaints"], dependencies=[Depends(get_current_user)]
)


@router.get("", response_model=list[ComplaintRead])
def list_complaints(session: SessionDep):
    return session.exec(select(Complaint).order_by(Complaint.name)).all()


@router.post("", response_model=ComplaintRead, status_code=201, dependencies=[Depends(require_admin)])
def create_complaint(payload: ComplaintCreate, session: SessionDep):
    complaint = Complaint(**payload.model_dump())
    session.add(complaint)
    session.commit()
    session.refresh(complaint)
    return complaint


@router.delete("/{complaint_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_complaint(complaint_id: int, session: SessionDep):
    complaint = session.get(Complaint, complaint_id)
    if not complaint:
        raise HTTPException(404, "Complaint not found")
    session.delete(complaint)
    session.commit()
