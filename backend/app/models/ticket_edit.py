"""Lightweight audit note for post-creation ticket edits (customer / work type / complaint).

One row per edit action; `note` summarises what changed. Kept separate from the lifecycle
(TicketUpdate) so corrections don't pollute the work timeline or affect WIP/escalation.
"""

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class TicketEdit(SQLModel, table=True):
    __tablename__ = "ticket_edit"

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    note: str
    edited_by_user_id: Optional[int] = Field(default=None, foreign_key="app_user.id")
    edited_at: datetime = Field(default_factory=datetime.now)
