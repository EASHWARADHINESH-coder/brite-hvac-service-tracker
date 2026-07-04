"""Schemas for the materials ledger (inward / issues / stock)."""

from datetime import date
from typing import Optional

from sqlmodel import SQLModel

from app.core.enums import InwardSource, IssueOutcome, IssueStatus


# ---- Inward ----
class InwardCreate(SQLModel):
    source_type: InwardSource
    material_name: str
    uom: str
    qty: float
    received_date: Optional[date] = None  # defaults to today
    doc_no: Optional[str] = None
    supplier: Optional[str] = None


class InwardRead(SQLModel):
    id: int
    inward_no: str
    source_type: InwardSource
    doc_no: Optional[str]
    supplier: Optional[str]
    material_name: str
    uom: str
    qty: float
    received_date: date


# ---- Issue / allocation ----
class IssueCreate(SQLModel):
    ticket_id: int
    material_name: str
    uom: str
    qty: float
    issue_date: Optional[date] = None  # defaults to today
    inward_id: Optional[int] = None
    customer_site: Optional[str] = None


class DeliverRequest(SQLModel):
    outcome: IssueOutcome  # Used -> delivery note generated; Not Used -> returned to stock


class IssueRead(SQLModel):
    id: int
    issue_no: str
    inward_id: Optional[int]
    ticket_id: int
    customer_site: Optional[str]
    material_name: str
    uom: str
    qty: float
    issue_date: date
    delivery_note_no: Optional[str]
    outcome: Optional[IssueOutcome]
    status: IssueStatus


# ---- Stock ----
class StockRow(SQLModel):
    material_name: str
    uom: str
    received: float
    consumed: float
    available: float
    allocated_pending: float
    on_claim: float = 0.0
