"""Payment schemas for Repaired Service follow-up."""

from datetime import date
from typing import Optional

from sqlmodel import SQLModel


class PaymentCreate(SQLModel):
    amount: float
    paid_date: Optional[date] = None
    remarks: Optional[str] = None


class PaymentRead(SQLModel):
    id: int
    ticket_id: int
    amount: float
    paid_date: date
    is_advance: bool
    remarks: Optional[str]


class PaymentSummary(SQLModel):
    """Payment status for a single ticket."""

    ticket_id: int
    ticket_no: str
    customer_name: Optional[str]
    total_amount: Optional[float]
    paid_amount: float
    balance: float
    fully_paid: bool
    ticket_status: str
    payments: list[PaymentRead] = []


class PaymentFollowUpRow(SQLModel):
    """A Repaired Service ticket with an outstanding balance."""

    ticket_id: int
    ticket_no: str
    customer_name: Optional[str]
    complaint_date: date
    total_amount: float
    paid_amount: float
    balance: float
    ticket_status: str
