"""Request/response schemas for master data resources."""

import re
from datetime import date
from typing import Optional

from pydantic import field_validator
from sqlmodel import SQLModel

from app.core.enums import ComplaintType, TeamType

_MOBILE_RE = re.compile(r"^\d{10}$")
_PINCODE_RE = re.compile(r"^\d{6}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ---- Customer ----
class CustomerCreate(SQLModel):
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    pincode: Optional[str] = None
    contact_person: Optional[str] = None
    contact_number: Optional[str] = None      # Primary Mobile no
    secondary_mobile: Optional[str] = None
    mail_id: Optional[str] = None
    is_amc: bool = False
    warranty_start_date: Optional[date] = None
    warranty_end_date: Optional[date] = None

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Name is required")
        return v.strip()

    @field_validator(
        "address", "city", "pincode", "contact_person",
        "contact_number", "secondary_mobile", "mail_id",
        mode="before",
    )
    @classmethod
    def _blank_to_none(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v.strip() if isinstance(v, str) else v

    @field_validator("contact_number", "secondary_mobile")
    @classmethod
    def _valid_mobile(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _MOBILE_RE.match(v):
            raise ValueError("Mobile number must be exactly 10 digits")
        return v

    @field_validator("pincode")
    @classmethod
    def _valid_pincode(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _PINCODE_RE.match(v):
            raise ValueError("Pincode must be exactly 6 digits")
        return v

    @field_validator("mail_id")
    @classmethod
    def _valid_email(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address")
        return v


class CustomerRead(CustomerCreate):
    id: int
    # Derived: "WTY" (within warranty) | "AMC" (active PMS WO) | "NIC".
    contract_status: str = "NIC"


class CustomerMerge(SQLModel):
    """Merge duplicate customer records into one surviving record."""

    survivor_id: int          # the record to keep (its name/details win)
    duplicate_ids: list[int]  # records whose tickets/PMS/claims move over, then are deleted


class MergeResult(SQLModel):
    survivor_id: int
    survivor_name: str
    merged: int = 0          # duplicate records removed
    tickets_moved: int = 0
    pms_moved: int = 0
    claims_moved: int = 0


# ---- Team ----
class TeamMemberCreate(SQLModel):
    name: str
    team_type: TeamType
    years_experience: Optional[int] = None
    mobile: Optional[str] = None       # optional
    email: Optional[str] = None        # optional
    skills: Optional[str] = None  # comma-separated skill names

    @field_validator("mobile", "email", "skills", mode="before")
    @classmethod
    def _team_blank_to_none(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v.strip() if isinstance(v, str) else v

    @field_validator("mobile")
    @classmethod
    def _team_valid_mobile(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _MOBILE_RE.match(v):
            raise ValueError("Mobile number must be exactly 10 digits")
        return v

    @field_validator("email")
    @classmethod
    def _team_valid_email(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address")
        return v


class TeamMemberCreateWithAccess(TeamMemberCreate):
    """Team create payload that may also provision a mobile login account."""

    grant_access: bool = False
    username: Optional[str] = None
    password: Optional[str] = None


class TeamMemberRead(TeamMemberCreate):
    id: int


# ---- Skill ----
class SkillCreate(SQLModel):
    name: str


class SkillRead(SkillCreate):
    id: int


# ---- Complaint ----
class ComplaintCreate(SQLModel):
    name: str
    complaint_type: ComplaintType


class ComplaintRead(ComplaintCreate):
    id: int


# ---- Material catalog ----
class MaterialItemCreate(SQLModel):
    name: str
    uom: str


class MaterialItemRead(MaterialItemCreate):
    id: int
