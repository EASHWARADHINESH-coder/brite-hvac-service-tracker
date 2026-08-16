"""Read model for ticket site photos."""

from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel


class TicketPhotoRead(SQLModel):
    id: int
    ticket_id: int
    original_name: str
    kind: str
    caption: Optional[str] = None
    size: int
    uploaded_by_name: Optional[str] = None
    uploaded_at: datetime
