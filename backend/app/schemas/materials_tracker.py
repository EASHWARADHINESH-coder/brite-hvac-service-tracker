"""Request/response schemas for the per-ticket Materials Tracker."""

from datetime import date
from typing import Optional

from sqlmodel import SQLModel

from app.core.enums import MachineType, WorkType


class MaterialsTrackerCreate(SQLModel):
    ticket_id: int
    material_name: str
    uom: str
    requested_qty: Optional[float] = None
    requested_date: Optional[date] = None
    received_qty: Optional[float] = None
    received_date: Optional[date] = None
    purchasing_group: Optional[str] = None
    responsible_person: Optional[str] = None


class MaterialsTrackerRead(MaterialsTrackerCreate):
    id: int
    complaint_date: Optional[date] = None
    work_type: Optional[WorkType] = None
    machine_type: Optional[MachineType] = None
