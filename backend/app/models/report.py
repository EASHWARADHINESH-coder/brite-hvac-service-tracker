"""Manual report PDFs uploaded against a ticket (stored on disk, metadata in DB)."""

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class TicketReport(SQLModel, table=True):
    __tablename__ = "ticket_report"

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    filename: str            # stored file name on disk (unique)
    original_name: str       # name the user uploaded
    size: int = 0            # bytes
    # "general" (default) or "commissioning" (installation report PDF).
    category: str = Field(default="general", index=True)
    uploaded_by_user_id: Optional[int] = Field(default=None, foreign_key="app_user.id")
    uploaded_at: datetime = Field(default_factory=datetime.now)
