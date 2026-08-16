"""In-app notifications shown in the top-bar bell.

One row per notification for a user. Event notifications (assigned, completed) are created
when the action happens; due/overdue ones are generated on demand by a sweep, deduped via
``dedupe_key`` so the same task doesn't notify twice for the same due date.
"""

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Notification(SQLModel, table=True):
    __tablename__ = "notification"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="app_user.id", index=True)
    kind: str  # task_assigned | task_due | task_overdue | task_completed | ticket_assigned
    title: str
    body: Optional[str] = None
    link: Optional[str] = None          # frontend route, e.g. "/tasks" or "/tickets/5"
    is_read: bool = Field(default=False, index=True)
    created_at: datetime = Field(default_factory=datetime.now)
    # Stops generated (due/overdue) notifications duplicating for the same task + date.
    dedupe_key: Optional[str] = Field(default=None, index=True)
