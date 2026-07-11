"""Master data tables: Customer, Team, Skill, Complaint, Materials Database."""

from datetime import date
from typing import Optional

from sqlmodel import Field, SQLModel

from app.core.enums import ComplaintType, TeamType


class Customer(SQLModel, table=True):
    __tablename__ = "customer"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    # CRM "Customer Id" (e.g. CID-14430) from the PMS export — dedupe key for imports.
    crm_customer_id: Optional[str] = Field(default=None, index=True)
    address: Optional[str] = None
    city: Optional[str] = None
    pincode: Optional[str] = None
    contact_person: Optional[str] = None
    contact_number: Optional[str] = None   # Primary Mobile no
    secondary_mobile: Optional[str] = None
    mail_id: Optional[str] = None
    is_amc: bool = Field(default=False)    # legacy flag; contract status is now derived
    # Warranty (WTY) period. Within these dates the contract status is WTY.
    warranty_start_date: Optional[date] = None
    warranty_end_date: Optional[date] = None


class TeamMember(SQLModel, table=True):
    __tablename__ = "team_member"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    team_type: TeamType
    years_experience: Optional[int] = None
    mobile: Optional[str] = None          # optional
    email: Optional[str] = None           # optional
    # Comma-separated skill names (multi-select in Excel); normalize to a link table later if needed.
    skills: Optional[str] = None


class Skill(SQLModel, table=True):
    __tablename__ = "skill"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)


class Complaint(SQLModel, table=True):
    __tablename__ = "complaint"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)            # "Compressor failure"
    complaint_type: ComplaintType            # drives skill derivation


class MaterialItem(SQLModel, table=True):
    """Materials Database master (catalog)."""

    __tablename__ = "material_item"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    uom: str                                  # Nos, kg, ...
