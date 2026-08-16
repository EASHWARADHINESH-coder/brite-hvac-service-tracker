"""In-app notifications for the top-bar bell.

Each user sees only their own notifications. Listing also runs a lightweight sweep that
generates due-soon / overdue task notifications on the fly (deduped), so no scheduler is needed.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep, get_current_user
from app.models.notification import Notification
from app.schemas.notification import NotificationList, NotificationRead
from app.services.notifications import sweep_due_tasks, unread_count

router = APIRouter(prefix="/notifications", tags=["notifications"],
                   dependencies=[Depends(get_current_user)])


@router.get("", response_model=NotificationList)
def list_notifications(session: SessionDep, user: CurrentUser, limit: int = 30) -> NotificationList:
    sweep_due_tasks(session, user.id)
    rows = session.exec(
        select(Notification).where(Notification.user_id == user.id)
        .order_by(Notification.id.desc()).limit(max(1, min(limit, 100)))
    ).all()
    return NotificationList(
        unread=unread_count(session, user.id),
        items=[NotificationRead(**n.model_dump()) for n in rows],
    )


@router.post("/{notification_id}/read", status_code=204)
def mark_read(notification_id: int, session: SessionDep, user: CurrentUser) -> None:
    n = session.get(Notification, notification_id)
    if not n or n.user_id != user.id:
        raise HTTPException(404, "Notification not found")
    if not n.is_read:
        n.is_read = True
        session.add(n)
        session.commit()


@router.post("/read-all", status_code=204)
def mark_all_read(session: SessionDep, user: CurrentUser) -> None:
    rows = session.exec(
        select(Notification).where(Notification.user_id == user.id, Notification.is_read == False)  # noqa: E712
    ).all()
    for n in rows:
        n.is_read = True
        session.add(n)
    if rows:
        session.commit()
