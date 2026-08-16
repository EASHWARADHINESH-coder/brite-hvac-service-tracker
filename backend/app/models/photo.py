"""Site photos attached to a ticket (stored on disk, metadata in DB).

Separate from TicketReport because the two have different rules: reports are Service Admin
paperwork, photos are site evidence captured by whoever did the work.
"""

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class TicketPhoto(SQLModel, table=True):
    __tablename__ = "ticket_photo"

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    filename: str             # stored file name on disk (unique)
    original_name: str        # name as uploaded
    content_type: str = "image/jpeg"
    size: int = 0             # bytes
    # "before" / "after" / "other" — drives the before/after pairing in the UI.
    kind: str = "other"
    caption: Optional[str] = None
    uploaded_by_user_id: Optional[int] = Field(default=None, foreign_key="app_user.id")
    uploaded_at: datetime = Field(default_factory=datetime.now)
