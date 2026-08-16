"""Ticket report (PDF) schemas."""

from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel


class TicketReportRead(SQLModel):
    id: int
    ticket_id: int
    original_name: str
    size: int
    category: str = "general"
    uploaded_by_name: Optional[str] = None
    uploaded_at: datetime
