"""Schemas for AMC material claims (Blue Star Ltd warranty replacement)."""

from datetime import date
from typing import Optional

from sqlmodel import SQLModel

from app.core.enums import ClaimStatus


class ClaimCreate(SQLModel):
    ticket_id: int
    material_name: str
    uom: str
    qty: float
    in_stock: bool = False
    engineer_user_id: Optional[int] = None
    technician_id: Optional[int] = None
    mr_no: Optional[str] = None
    mr_date: Optional[date] = None  # defaults to today
    remarks: Optional[str] = None


class ClaimUpdate(SQLModel):
    """Advance the claim by recording milestone fields. Status is recomputed server-side."""

    delivery_challan_no: Optional[str] = None
    delivery_challan_date: Optional[date] = None
    used_date: Optional[date] = None
    defective_returned_date: Optional[date] = None
    pod_no: Optional[str] = None
    pod_date: Optional[date] = None
    mr_no: Optional[str] = None
    remarks: Optional[str] = None


class ClaimRead(SQLModel):
    id: int
    claim_no: str
    ticket_id: int
    customer_id: Optional[int]
    material_name: str
    uom: str
    qty: float
    in_stock: bool
    engineer_user_id: Optional[int]
    technician_id: Optional[int]
    mr_no: Optional[str]
    mr_date: date
    delivery_challan_no: Optional[str]
    delivery_challan_date: Optional[date]
    used_date: Optional[date]
    defective_returned_date: Optional[date]
    pod_no: Optional[str]
    pod_date: Optional[date]
    status: ClaimStatus
    remarks: Optional[str]


class DefectiveStockRow(SQLModel):
    """A defective unit currently held at the office, awaiting dispatch to BSL."""

    claim_id: int
    claim_no: str
    ticket_id: int
    material_name: str
    uom: str
    qty: float
    defective_returned_date: Optional[date]
    engineer_user_id: Optional[int]
    technician_id: Optional[int]
