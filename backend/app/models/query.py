"""Staff queries raised to the Service Admin (and Engineers).

Any logged-in user can raise a query; Admin/Engineer resolve it with a reply.
"""

from datetime import date
from typing import Optional

from sqlmodel import Field, SQLModel

from app.core.enums import QueryStatus


class Query(SQLModel, table=True):
    __tablename__ = "query"

    id: Optional[int] = Field(default=None, primary_key=True)
    raised_by_user_id: int = Field(foreign_key="app_user.id", index=True)
    subject: str
    message: str
    ticket_id: Optional[int] = Field(default=None, foreign_key="ticket.id")

    status: QueryStatus = Field(default=QueryStatus.OPEN, index=True)
    reply: Optional[str] = None  # admin/engineer resolution
    resolved_by_user_id: Optional[int] = Field(default=None, foreign_key="app_user.id")
    created_at: date = Field(default_factory=date.today)
    resolved_at: Optional[date] = None
