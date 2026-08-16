"""Payments recorded against a (Repaired Service) ticket.

The ticket carries the agreed total_amount; each Payment reduces the balance.
The advance entered at ticket creation is stored as the first payment.
"""

from datetime import date
from typing import Optional

from sqlmodel import Field, SQLModel


class Payment(SQLModel, table=True):
    __tablename__ = "payment"

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    amount: float
    paid_date: date = Field(default_factory=date.today)
    is_advance: bool = Field(default=False)  # the advance recorded at creation
    # A signed adjustment to the collected amount (Admin only), e.g. a write-off or reversal.
    is_correction: bool = Field(default=False)
    remarks: Optional[str] = None
