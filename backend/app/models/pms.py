"""PMS (Preventive Maintenance Schedule) work orders."""

from datetime import date
from typing import Optional

from sqlmodel import Field, SQLModel


class PMS(SQLModel, table=True):
    __tablename__ = "pms"

    id: Optional[int] = Field(default=None, primary_key=True)
    customer_id: int = Field(foreign_key="customer.id", index=True)
    wo_number: str = Field(index=True)
    wo_start_date: Optional[date] = None
    wo_end_date: Optional[date] = None
    schedule: Optional[str] = None  # e.g. "4 PMS/Year", "6 PMS/Year"

    # Complaint used when a scheduled visit becomes a PMS ticket (no machine type for PMS).
    complaint: Optional[str] = None  # defaults to "General Service" in the API

    # Up to 6 planned visit dates (Schedule 1–6 in the Excel).
    schedule_1: Optional[date] = None
    schedule_2: Optional[date] = None
    schedule_3: Optional[date] = None
    schedule_4: Optional[date] = None
    schedule_5: Optional[date] = None
    schedule_6: Optional[date] = None


class PMSVisitTicket(SQLModel, table=True):
    """Links a PMS work order's visit (1–6) to the ticket generated for it.

    Presence of a row means that visit has already produced a ticket (dedup).
    """

    __tablename__ = "pms_visit_ticket"

    pms_id: int = Field(foreign_key="pms.id", primary_key=True)
    visit_no: int = Field(primary_key=True)  # 1..6
    ticket_id: int = Field(foreign_key="ticket.id")
