"""Query schemas."""

from datetime import date
from typing import Optional

from sqlmodel import SQLModel

from app.core.enums import QueryStatus


class QueryCreate(SQLModel):
    subject: str
    message: str
    ticket_id: Optional[int] = None


class QueryResolve(SQLModel):
    reply: str


class QueryRead(SQLModel):
    id: int
    raised_by_user_id: int
    raised_by_name: Optional[str] = None
    subject: str
    message: str
    ticket_id: Optional[int]
    ticket_no: Optional[str] = None
    status: QueryStatus
    reply: Optional[str]
    resolved_by_name: Optional[str] = None
    created_at: date
    resolved_at: Optional[date]
