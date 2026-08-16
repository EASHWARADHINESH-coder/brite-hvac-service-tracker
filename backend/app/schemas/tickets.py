"""Request/response schemas for tickets and their lifecycle updates."""

from datetime import date, datetime
from typing import Optional

from sqlmodel import SQLModel

from app.core.enums import (
    LifecycleStage,
    MachineType,
    TicketStatus,
    WorkType,
)


# ---- Ticket ----
class TicketCreate(SQLModel):
    customer_id: int
    complaint_date: date
    work_type: WorkType
    machine_type: Optional[MachineType] = None
    # Primary complaint name (must exist in the Complaint master) — drives skill derivation.
    primary_complaint: Optional[str] = None
    # Optional manual skill override. When omitted, the skill is auto-derived
    # from the primary complaint ("<Complaint Type> - <Machine Type>").
    skill: Optional[str] = None
    remarks: Optional[str] = None
    # Repaired Service payment (total required for Repaired Service; advance optional).
    total_amount: Optional[float] = None
    advance_amount: Optional[float] = None


class TicketUpdateCreate(SQLModel):
    """A new stage row appended to a ticket's lifecycle."""

    stage: LifecycleStage = LifecycleStage.ASSIGNED
    action_date: Optional[date] = None
    job_lead: Optional[str] = None
    team_ids: list[int] = []
    complaints: Optional[str] = None
    materials: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    remarks: Optional[str] = None
    reopen: bool = False
    reopen_reason: Optional[str] = None


class MaterialPendingCreate(SQLModel):
    """Blue Star branch: raise a claim + move the ticket to Material Pending, atomically.

    A manually-typed material name is added to the Materials catalog for future MRs.
    """

    material_name: str
    uom: str = "Nos"
    qty: float = 1
    in_stock: bool = False
    mr_no: Optional[str] = None       # SAP MR Number
    technician_id: Optional[int] = None
    action_date: Optional[date] = None
    remarks: Optional[str] = None


class SpareItem(SQLModel):
    """One spare recorded at Work Started — a Blue Star claim, or vendor/supplier arranged."""

    source: str = "bsl"                  # "bsl" | "non_bsl"
    material_name: str
    uom: str = "Nos"
    qty: float = 1
    # BSL only
    in_stock: bool = False
    mr_no: Optional[str] = None          # SAP MR Number
    technician_id: Optional[int] = None
    # Non-BSL only
    vendor: Optional[str] = None


class WorkStartedCreate(SQLModel):
    """Work Started with any number of spares. Each BSL spare raises its own claim."""

    action_date: Optional[date] = None
    remarks: Optional[str] = None
    spares: list[SpareItem] = []
    close_now: bool = False              # ignored when a BSL claim is raised
    end_date: Optional[date] = None
    # Crew present for this stage. Defaults to carrying the previous stage's team forward
    # (the UI pre-ticks "same team"); an explicit list overrides it.
    team_ids: list[int] = []


class TeamMemberBrief(SQLModel):
    id: int
    name: str


class TicketUpdateRead(SQLModel):
    id: int
    ticket_id: int
    stage: LifecycleStage
    action_date: Optional[date]
    job_lead: Optional[str]
    complaints: Optional[str]
    materials: Optional[str]
    start_date: Optional[date]
    end_date: Optional[date]
    status: TicketStatus
    remarks: Optional[str]
    reopen: bool
    reopen_reason: Optional[str]
    team: list[TeamMemberBrief] = []


class TicketRead(SQLModel):
    id: int
    ticket_no: str
    customer_id: int
    complaint_date: date
    work_type: WorkType
    machine_type: Optional[MachineType]
    skill: Optional[str]
    status: TicketStatus
    reopen: bool
    starred: bool = False
    customer_name: Optional[str] = None
    customer_city: Optional[str] = None
    # Assignment SLA (72h) helpers, computed from the lifecycle chain.
    is_assigned: bool = False
    assign_by: Optional[date] = None
    assignment_overdue: bool = False
    # True while the ticket is still waiting on material FROM Blue Star (MR raised / received /
    # awaiting replenishment). Drives the "MR Pending" tag. The work can be closed regardless.
    mr_pending: bool = False
    # True once the replacement is fitted (work done) but the defective unit has NOT yet been
    # dispatched back to BSL (no POD). Drives the "Defective Part" tag and the Material Return
    # KPI — i.e. an outstanding return we still owe Blue Star.
    defective_pending: bool = False
    # Repaired Service payment (None for other work types).
    total_amount: Optional[float] = None
    paid_amount: Optional[float] = None
    balance: Optional[float] = None


class TicketEditRead(SQLModel):
    id: int
    note: str
    edited_by_name: Optional[str] = None
    edited_at: datetime


class TicketPatch(SQLModel):
    """Post-creation edit of a ticket's core fields (customer / work type / complaint)."""
    customer_id: Optional[int] = None
    work_type: Optional[WorkType] = None
    primary_complaint: Optional[str] = None


class TicketCancel(SQLModel):
    reason: str


class TicketStar(SQLModel):
    starred: bool


class TicketBill(SQLModel):
    """Manual billing details for a Repaired Service ticket (entered retroactively)."""
    bill_no: Optional[str] = None
    bill_date: Optional[date] = None
    bill_remarks: Optional[str] = None


class TicketCommissioning(SQLModel):
    """Free-text installation/commissioning report (status + remarks)."""
    status: Optional[str] = None
    remarks: Optional[str] = None


class TicketDetail(TicketRead):
    primary_complaint: Optional[str] = None
    # Whether Testing & Commissioning should be auto-suggested (Gas Leakage / Compressor failure).
    requires_tc: bool = False
    cancel_reason: Optional[str] = None
    # Manual billing (Repaired Service).
    bill_no: Optional[str] = None
    bill_date: Optional[date] = None
    bill_remarks: Optional[str] = None
    # Commissioning installation report — shown when the primary complaint type is Commissioning.
    is_commissioning: bool = False
    commissioning_status: Optional[str] = None
    commissioning_remarks: Optional[str] = None
    updates: list[TicketUpdateRead] = []
    edits: list[TicketEditRead] = []
