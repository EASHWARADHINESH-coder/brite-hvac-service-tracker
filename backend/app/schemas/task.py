"""Task request/response schemas."""

from datetime import date
from typing import Optional

from sqlmodel import SQLModel

from app.core.enums import TaskPriority, TaskStatus


class TaskCreate(SQLModel):
    title: str
    description: Optional[str] = None
    assignee_user_id: int
    ticket_id: Optional[int] = None
    priority: TaskPriority = TaskPriority.NORMAL
    due_date: Optional[date] = None


class TaskUpdate(SQLModel):
    title: Optional[str] = None
    description: Optional[str] = None
    assignee_user_id: Optional[int] = None
    ticket_id: Optional[int] = None
    priority: Optional[TaskPriority] = None
    due_date: Optional[date] = None
    status: Optional[TaskStatus] = None


class AssigneeRead(SQLModel):
    """Minimal user info for the assignee picker (Admin/Engineer can read)."""

    id: int
    label: str
    role: str


class TaskRead(SQLModel):
    id: int
    title: str
    description: Optional[str]
    assignee_user_id: int
    assigned_by_user_id: Optional[int]
    ticket_id: Optional[int]
    priority: TaskPriority
    due_date: Optional[date]
    status: TaskStatus
    created_at: date
    # Enrichments for the UI.
    assignee_name: Optional[str] = None
    assigned_by_name: Optional[str] = None
    ticket_no: Optional[str] = None
    overdue: bool = False
