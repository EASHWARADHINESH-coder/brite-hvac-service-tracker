"""Per-ticket Materials Tracker (requested vs received quantities)."""

from fastapi import APIRouter, Depends, HTTPException, status as http_status
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep, get_current_user, require_engineer
from app.core.enums import UserRole
from app.models.materials import MaterialsTracker
from app.models.tickets import Ticket
from app.schemas.materials_tracker import (
    MaterialsTrackerCreate,
    MaterialsTrackerRead,
)
from app.services.permissions import is_privileged, owned_ticket_ids

router = APIRouter(
    prefix="/materials-tracker", tags=["materials-tracker"], dependencies=[Depends(get_current_user)]
)


@router.get("", response_model=list[MaterialsTrackerRead])
def list_entries(session: SessionDep, user: CurrentUser, ticket_id: int | None = None):
    stmt = select(MaterialsTracker)
    if ticket_id:
        stmt = stmt.where(MaterialsTracker.ticket_id == ticket_id)
    # Task-scoped roles only see entries for their own tickets.
    if not is_privileged(user):
        owned = owned_ticket_ids(session, user)
        if not owned:
            return []
        stmt = stmt.where(MaterialsTracker.ticket_id.in_(owned))
    return session.exec(stmt.order_by(MaterialsTracker.id)).all()


@router.post("", response_model=MaterialsTrackerRead, status_code=201)
def create_entry(payload: MaterialsTrackerCreate, session: SessionDep, user: CurrentUser):
    ticket = session.get(Ticket, payload.ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")

    # Engineer+ for any ticket; Technician only for their own (record material usage).
    if not is_privileged(user):
        if user.role != UserRole.TECHNICIAN:
            raise HTTPException(http_status.HTTP_403_FORBIDDEN, "View-only role")
        if payload.ticket_id not in owned_ticket_ids(session, user):
            raise HTTPException(http_status.HTTP_403_FORBIDDEN, "Not your task")

    entry = MaterialsTracker(
        **payload.model_dump(),
        # Snapshot ticket context onto the row (mirrors the Excel layout).
        complaint_date=ticket.complaint_date,
        work_type=ticket.work_type,
        machine_type=ticket.machine_type,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


@router.put("/{entry_id}", response_model=MaterialsTrackerRead, dependencies=[Depends(require_engineer)])
def update_entry(entry_id: int, payload: MaterialsTrackerCreate, session: SessionDep):
    entry = session.get(MaterialsTracker, entry_id)
    if not entry:
        raise HTTPException(404, "Entry not found")
    for key, value in payload.model_dump().items():
        setattr(entry, key, value)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=204, dependencies=[Depends(require_engineer)])
def delete_entry(entry_id: int, session: SessionDep):
    entry = session.get(MaterialsTracker, entry_id)
    if not entry:
        raise HTTPException(404, "Entry not found")
    session.delete(entry)
    session.commit()
