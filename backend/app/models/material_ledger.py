"""Materials ledger: inward (stock received) and issues (allocated → delivery note / returned).

Stock is tracked globally per material name (one warehouse), matching the Excel.
  available = received − consumed   (Used reduces stock; Not Used returns it)
"""

from datetime import date
from typing import Optional

from sqlmodel import Field, SQLModel

from app.core.enums import InwardSource, IssueOutcome, IssueStatus


class MaterialInward(SQLModel, table=True):
    __tablename__ = "material_inward"

    id: Optional[int] = Field(default=None, primary_key=True)
    inward_no: str = Field(index=True, unique=True)  # IN+YYYYMMDD+nn
    source_type: InwardSource
    doc_no: Optional[str] = None                     # SO / MR / supplier doc reference
    supplier: Optional[str] = None
    material_name: str = Field(index=True)
    uom: str
    qty: float
    received_date: date


class MaterialIssue(SQLModel, table=True):
    """A quantity allocated from stock to a ticket, then delivered (Used) or returned (Not Used)."""

    __tablename__ = "material_issue"

    id: Optional[int] = Field(default=None, primary_key=True)
    issue_no: str = Field(index=True, unique=True)   # ISS+YYYYMMDD+nn
    inward_id: Optional[int] = Field(default=None, foreign_key="material_inward.id")
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    customer_site: Optional[str] = None

    material_name: str = Field(index=True)
    uom: str
    qty: float
    issue_date: date

    delivery_note_no: Optional[str] = None           # DN+YYYYMMDD+nn, set on Used
    outcome: Optional[IssueOutcome] = None
    status: IssueStatus = Field(default=IssueStatus.ALLOCATED, index=True)
