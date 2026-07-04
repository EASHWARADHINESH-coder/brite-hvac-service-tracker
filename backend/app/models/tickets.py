"""Ticket, ticket lifecycle updates, and ticket↔team link.

The Excel "Ticket" sheet is the current snapshot; the "Ticket Database" sheet is the
append-only lifecycle (one ticket → many rows). We model that as Ticket (1) → TicketUpdate (N).
"""

from datetime import date
from typing import Optional

from sqlmodel import Field, Relationship, SQLModel

from app.core.enums import (
    LifecycleStage,
    MachineType,
    TicketStatus,
    WorkType,
)


class TicketTeamLink(SQLModel, table=True):
    """Many-to-many: a ticket update can involve multiple team members."""

    __tablename__ = "ticket_team_link"

    ticket_update_id: Optional[int] = Field(
        default=None, foreign_key="ticket_update.id", primary_key=True
    )
    team_member_id: Optional[int] = Field(
        default=None, foreign_key="team_member.id", primary_key=True
    )


class Ticket(SQLModel, table=True):
    __tablename__ = "ticket"

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_no: str = Field(index=True, unique=True)  # e.g. B2026061301

    customer_id: int = Field(foreign_key="customer.id", index=True)
    complaint_date: date
    work_type: WorkType
    machine_type: Optional[MachineType] = None  # PMS tickets have none (site name shown instead)

    # Derived: "<Complaint Type> - <Machine Type>", set on create from the primary complaint.
    skill: Optional[str] = None

    # Repaired Service payment tracking: total agreed amount (payments recorded separately).
    total_amount: Optional[float] = None

    status: TicketStatus = Field(default=TicketStatus.OPEN, index=True)
    reopen: bool = Field(default=False)

    updates: list["TicketUpdate"] = Relationship(back_populates="ticket")


class TicketUpdate(SQLModel, table=True):
    """One stage/row in a ticket's lifecycle (mirrors a Ticket Database row)."""

    __tablename__ = "ticket_update"

    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)

    stage: LifecycleStage = Field(default=LifecycleStage.LOGGED)
    action_date: Optional[date] = None
    job_lead: Optional[str] = None            # single select
    complaints: Optional[str] = None          # complaint(s) for this stage
    materials: Optional[str] = None           # free-text materials note ("Nil", or list)
    start_date: Optional[date] = None
    end_date: Optional[date] = None           # presence ⇒ Closed (Excel auto-rule)
    status: TicketStatus = Field(default=TicketStatus.OPEN)
    remarks: Optional[str] = None
    reopen: bool = Field(default=False)
    reopen_reason: Optional[str] = None

    ticket: Optional[Ticket] = Relationship(back_populates="updates")
    team: list["TeamMember"] = Relationship(link_model=TicketTeamLink)  # type: ignore[name-defined]


# Late import to wire the link-model relationship without a circular import at module load.
from app.models.masters import TeamMember  # noqa: E402,F401
