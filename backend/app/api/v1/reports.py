"""Manual PDF report uploads per ticket.

Files are stored under uploads/tickets/<ticket_id>/; the DB keeps metadata.
Upload/delete are Service Admin only; anyone who can view the ticket can download.
"""

import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status as http_status
from fastapi.responses import FileResponse
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep, get_current_user, require_admin
from app.models.report import TicketReport
from app.models.tickets import Ticket
from app.models.user import User
from app.schemas.report import TicketReportRead
from app.services.permissions import can_view_ticket

router = APIRouter(prefix="/tickets", tags=["reports"], dependencies=[Depends(get_current_user)])

UPLOAD_ROOT = Path("uploads") / "tickets"
MAX_BYTES = 20 * 1024 * 1024  # 20 MB


def _to_read(session, r: TicketReport) -> TicketReportRead:
    uploader = session.get(User, r.uploaded_by_user_id) if r.uploaded_by_user_id else None
    return TicketReportRead(
        id=r.id,
        ticket_id=r.ticket_id,
        original_name=r.original_name,
        size=r.size,
        category=r.category,
        uploaded_by_name=(uploader.full_name or uploader.username) if uploader else None,
        uploaded_at=r.uploaded_at,
    )


@router.get("/{ticket_id}/reports", response_model=list[TicketReportRead])
def list_reports(ticket_id: int, session: SessionDep, user: CurrentUser,
                 category: str | None = None):
    if not can_view_ticket(session, user, ticket_id):
        raise HTTPException(http_status.HTTP_403_FORBIDDEN, "Not your task")
    query = select(TicketReport).where(TicketReport.ticket_id == ticket_id)
    if category:
        query = query.where(TicketReport.category == category)
    reports = session.exec(query.order_by(TicketReport.id.desc())).all()
    return [_to_read(session, r) for r in reports]


@router.post("/{ticket_id}/reports", response_model=TicketReportRead, status_code=201,
             dependencies=[Depends(require_admin)])
def upload_report(
    ticket_id: int, session: SessionDep, user: CurrentUser, file: UploadFile = File(...),
    category: str = Form("general"),
):
    if not session.get(Ticket, ticket_id):
        raise HTTPException(404, "Ticket not found")
    name = file.filename or "report.pdf"
    if not name.lower().endswith(".pdf") and file.content_type != "application/pdf":
        raise HTTPException(400, "Only PDF files are allowed")

    contents = file.file.read()
    if len(contents) > MAX_BYTES:
        raise HTTPException(400, "File too large (max 20 MB)")

    folder = UPLOAD_ROOT / str(ticket_id)
    folder.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4().hex}.pdf"
    (folder / stored).write_bytes(contents)

    report = TicketReport(
        ticket_id=ticket_id,
        filename=stored,
        original_name=name,
        size=len(contents),
        category=category or "general",
        uploaded_by_user_id=user.id,
        uploaded_at=datetime.now(),
    )
    session.add(report)
    session.commit()
    session.refresh(report)
    return _to_read(session, report)


@router.get("/{ticket_id}/reports/{report_id}/download")
def download_report(ticket_id: int, report_id: int, session: SessionDep, user: CurrentUser):
    if not can_view_ticket(session, user, ticket_id):
        raise HTTPException(http_status.HTTP_403_FORBIDDEN, "Not your task")
    report = session.get(TicketReport, report_id)
    if not report or report.ticket_id != ticket_id:
        raise HTTPException(404, "Report not found")
    path = UPLOAD_ROOT / str(ticket_id) / report.filename
    if not path.exists():
        raise HTTPException(404, "File missing on disk")
    return FileResponse(path, media_type="application/pdf", filename=report.original_name)


@router.delete("/{ticket_id}/reports/{report_id}", status_code=204,
               dependencies=[Depends(require_admin)])
def delete_report(ticket_id: int, report_id: int, session: SessionDep):
    report = session.get(TicketReport, report_id)
    if not report or report.ticket_id != ticket_id:
        raise HTTPException(404, "Report not found")
    path = UPLOAD_ROOT / str(ticket_id) / report.filename
    if path.exists():
        path.unlink()
    session.delete(report)
    session.commit()
