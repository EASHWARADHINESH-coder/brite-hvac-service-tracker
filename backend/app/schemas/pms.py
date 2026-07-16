"""Request/response schemas for PMS work orders."""

from datetime import date
from typing import Optional

from sqlmodel import SQLModel


class PMSCreate(SQLModel):
    customer_id: int
    wo_number: str
    wo_start_date: Optional[date] = None
    wo_end_date: Optional[date] = None
    schedule: Optional[str] = None  # frequency label, e.g. "4 PMS/Year"
    complaint: Optional[str] = None  # defaults to "General Service"
    # If omitted, Schedule 1–6 are auto-generated from wo_start_date + schedule.
    auto_generate: bool = True


class PMSRead(SQLModel):
    id: int
    customer_id: int
    wo_number: str
    wo_start_date: Optional[date]
    wo_end_date: Optional[date]
    schedule: Optional[str]
    complaint: Optional[str]
    schedule_1: Optional[date]
    schedule_2: Optional[date]
    schedule_3: Optional[date]
    schedule_4: Optional[date]
    schedule_5: Optional[date]
    schedule_6: Optional[date]


class PMSVisitRow(SQLModel):
    """One scheduled visit with its status, site (customer) and generated ticket (if any)."""

    pms_id: int
    wo_number: str
    customer_name: Optional[str]  # the site name
    visit_no: int
    visit_date: date
    status: str  # "Generated" | "Due" | "Upcoming"
    ticket_id: Optional[int] = None
    ticket_no: Optional[str] = None


class GenerateResult(SQLModel):
    created: int
    tickets: list[str] = []  # ticket numbers created


class RemoveResult(SQLModel):
    """Result of removing generated-but-untouched PMS tickets."""

    removed: int
    tickets: list[str] = []  # ticket numbers removed
    kept: int = 0            # generated tickets left alone because work had started
