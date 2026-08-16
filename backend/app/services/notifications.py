"""Notification helpers — create event notifications and generate due/overdue ones on demand."""

from datetime import date

from sqlmodel import Session, func, select

from app.core.enums import TaskStatus
from app.models.notification import Notification
from app.models.task import Task

# A task is "due soon" within this many days of its due date.
DUE_SOON_DAYS = 2


def notify(
    session: Session,
    user_id: int,
    kind: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    dedupe_key: str | None = None,
    commit: bool = True,
) -> Notification | None:
    """Create a notification for a user. If dedupe_key is set and already exists, do nothing."""
    if not user_id:
        return None
    if dedupe_key:
        existing = session.exec(
            select(Notification).where(
                Notification.user_id == user_id, Notification.dedupe_key == dedupe_key
            )
        ).first()
        if existing:
            return existing
    n = Notification(user_id=user_id, kind=kind, title=title, body=body, link=link, dedupe_key=dedupe_key)
    session.add(n)
    if commit:
        session.commit()
        session.refresh(n)
    return n


def sweep_due_tasks(session: Session, user_id: int, today: date | None = None) -> None:
    """Generate due-soon / overdue notifications for a user's still-open dated tasks (deduped)."""
    today = today or date.today()
    tasks = session.exec(
        select(Task).where(
            Task.assignee_user_id == user_id,
            Task.status != TaskStatus.DONE,
            Task.due_date.is_not(None),
        )
    ).all()
    created = False
    for t in tasks:
        if t.due_date < today:
            n = notify(
                session, user_id, "task_overdue",
                title=f"Task overdue: {t.title}",
                body=f"Was due {t.due_date.isoformat()}",
                link="/tasks", dedupe_key=f"overdue:{t.id}:{t.due_date.isoformat()}", commit=False,
            )
            created = created or n is not None
        elif (t.due_date - today).days <= DUE_SOON_DAYS:
            n = notify(
                session, user_id, "task_due",
                title=f"Task due soon: {t.title}",
                body=f"Due {t.due_date.isoformat()}",
                link="/tasks", dedupe_key=f"due:{t.id}:{t.due_date.isoformat()}", commit=False,
            )
            created = created or n is not None
    if created:
        session.commit()


def unread_count(session: Session, user_id: int) -> int:
    return int(session.exec(
        select(func.count()).select_from(Notification).where(
            Notification.user_id == user_id, Notification.is_read == False  # noqa: E712
        )
    ).one())
