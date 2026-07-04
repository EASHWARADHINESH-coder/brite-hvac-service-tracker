"""Tasks assigned to users (Service Admin / Engineer assign; assignee works them).

A task is a standalone to-do that may optionally reference a ticket.
"""

from datetime import date
from typing import Optional

from sqlmodel import Field, SQLModel

from app.core.enums import TaskPriority, TaskStatus


class Task(SQLModel, table=True):
    __tablename__ = "task"

    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: Optional[str] = None

    assignee_user_id: int = Field(foreign_key="app_user.id", index=True)
    assigned_by_user_id: Optional[int] = Field(default=None, foreign_key="app_user.id")

    # Optional link to a ticket.
    ticket_id: Optional[int] = Field(default=None, foreign_key="ticket.id", index=True)

    priority: TaskPriority = Field(default=TaskPriority.NORMAL)
    due_date: Optional[date] = None
    status: TaskStatus = Field(default=TaskStatus.OPEN, index=True)
    created_at: date = Field(default_factory=date.today)
