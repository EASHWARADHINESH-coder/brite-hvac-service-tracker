"""Materials Tracker — per-ticket requested vs received quantities (Excel "Materials Tracker").

Phase 3 adds the full inward → issue → delivery-note ledger; this is the simpler tracker first.
"""

from datetime import date
from typing import Optional

from sqlmodel import Field, SQLModel

from app.core.enums import MachineType, WorkType


class MaterialsTracker(SQLModel, table=True):
    __tablename__ = "materials_tracker"

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)

    # Denormalized snapshot fields (as in the Excel row) for fast listing.
    complaint_date: Optional[date] = None
    work_type: Optional[WorkType] = None
    machine_type: Optional[MachineType] = None

    material_name: str
    uom: str
    requested_qty: Optional[float] = None
    requested_date: Optional[date] = None
    received_qty: Optional[float] = None
    received_date: Optional[date] = None
    purchasing_group: Optional[str] = None   # Office Stock | Supplier | ...
    responsible_person: Optional[str] = None
