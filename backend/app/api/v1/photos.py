"""Site photos per ticket — before/after evidence for AMC disputes and Blue Star claims.

Permission model differs deliberately from report PDFs:
  * upload  — anyone who can *edit* the ticket, i.e. the technician who did the work.
              Photos are worthless if only an Admin sitting in the office can add them.
  * view    — anyone who can view the ticket.
  * delete  — Service Admin only, so site evidence can't be quietly removed.
"""

import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status as http_status
from fastapi.responses import FileResponse
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep, get_current_user, require_admin
from app.core.enums import UserRole
from app.models.photo import TicketPhoto
from app.models.tickets import Ticket
from app.models.user import User
from app.schemas.photo import TicketPhotoRead
from app.services.permissions import can_view_ticket, is_privileged, owned_ticket_ids

router = APIRouter(prefix="/tickets", tags=["photos"], dependencies=[Depends(get_current_user)])

UPLOAD_ROOT = Path("uploads") / "photos"
MAX_BYTES = 10 * 1024 * 1024  # 10 MB per photo (the browser downscales before sending)
ALLOWED = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
KINDS = {"before", "after", "other"}


def _can_edit_ticket(session, user: User, ticket_id: int) -> bool:
    """Admin/Engineer anywhere; a Technician only on their own tickets. Helpers never."""
    if is_privileged(user):
        return True
    if user.role != UserRole.TECHNICIAN:
        return False
    return ticket_id in owned_ticket_ids(session, user)


def _to_read(session, p: TicketPhoto) -> TicketPhotoRead:
    uploader = session.get(User, p.uploaded_by_user_id) if p.uploaded_by_user_id else None
    return TicketPhotoRead(
        id=p.id,
        ticket_id=p.ticket_id,
        original_name=p.original_name,
        kind=p.kind,
        caption=p.caption,
        size=p.size,
        uploaded_by_name=(uploader.full_name or uploader.username) if uploader else None,
        uploaded_at=p.uploaded_at,
    )


@router.get("/{ticket_id}/photos", response_model=list[TicketPhotoRead])
def list_photos(ticket_id: int, session: SessionDep, user: CurrentUser):
    if not can_view_ticket(session, user, ticket_id):
        raise HTTPException(http_status.HTTP_403_FORBIDDEN, "Not your task")
    photos = session.exec(
        select(TicketPhoto).where(TicketPhoto.ticket_id == ticket_id)
        .order_by(TicketPhoto.id.asc())
    ).all()
    return [_to_read(session, p) for p in photos]


@router.post("/{ticket_id}/photos", response_model=TicketPhotoRead, status_code=201)
def upload_photo(
    ticket_id: int,
    session: SessionDep,
    user: CurrentUser,
    file: UploadFile = File(...),
    kind: str = Form("other"),
    caption: str | None = Form(None),
):
    if not session.get(Ticket, ticket_id):
        raise HTTPException(404, "Ticket not found")
    if not _can_edit_ticket(session, user, ticket_id):
        raise HTTPException(http_status.HTTP_403_FORBIDDEN, "You can't add photos to this ticket")
    if kind not in KINDS:
        raise HTTPException(400, f"kind must be one of: {', '.join(sorted(KINDS))}")

    ctype = (file.content_type or "").lower()
    if ctype not in ALLOWED:
        raise HTTPException(400, "Only JPEG, PNG or WebP images are allowed")

    contents = file.file.read()
    if len(contents) > MAX_BYTES:
        raise HTTPException(400, "Image too large (max 10 MB after downscaling)")

    folder = UPLOAD_ROOT / str(ticket_id)
    folder.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4().hex}{ALLOWED[ctype]}"
    (folder / stored).write_bytes(contents)

    photo = TicketPhoto(
        ticket_id=ticket_id,
        filename=stored,
        original_name=file.filename or stored,
        content_type=ctype,
        size=len(contents),
        kind=kind,
        caption=(caption or None),
        uploaded_by_user_id=user.id,
        uploaded_at=datetime.now(),
    )
    session.add(photo)
    session.commit()
    session.refresh(photo)
    return _to_read(session, photo)


@router.get("/{ticket_id}/photos/{photo_id}/file")
def get_photo_file(ticket_id: int, photo_id: int, session: SessionDep, user: CurrentUser):
    if not can_view_ticket(session, user, ticket_id):
        raise HTTPException(http_status.HTTP_403_FORBIDDEN, "Not your task")
    photo = session.get(TicketPhoto, photo_id)
    if not photo or photo.ticket_id != ticket_id:
        raise HTTPException(404, "Photo not found")
    path = UPLOAD_ROOT / str(ticket_id) / photo.filename
    if not path.exists():
        raise HTTPException(404, "File missing on disk")
    return FileResponse(path, media_type=photo.content_type, filename=photo.original_name)


@router.delete("/{ticket_id}/photos/{photo_id}", status_code=204,
               dependencies=[Depends(require_admin)])
def delete_photo(ticket_id: int, photo_id: int, session: SessionDep):
    photo = session.get(TicketPhoto, photo_id)
    if not photo or photo.ticket_id != ticket_id:
        raise HTTPException(404, "Photo not found")
    path = UPLOAD_ROOT / str(ticket_id) / photo.filename
    if path.exists():
        path.unlink()
    session.delete(photo)
    session.commit()
