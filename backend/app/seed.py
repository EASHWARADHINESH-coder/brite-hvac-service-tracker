"""Seed master data (and optional demo transactions) from the SERVICE WORKFLOW Excel.

Master data is hard-coded here (it is small and stable) so the app seeds with no Excel file
present. Idempotent: skips tables that already have rows.
"""

from sqlmodel import Session, select

from app.core.enums import ComplaintType, TeamType
from app.database import engine
from app.models.masters import Complaint, MaterialItem, Skill, TeamMember

SKILLS = [
    "Major Breakdown - VRF", "Major Breakdown - Ductable", "Major Breakdown - Package",
    "Major Breakdown - Chiller", "Major Breakdown - Split", "Major Breakdown - Cassette",
    "Major Breakdown - AHU",
    "Commissioning - VRF", "Commissioning - Ductable", "Commissioning - Package",
    "Commissioning - Chiller", "Commissioning - Split", "Commissioning - Cassette",
    "Welding - VRF/Ductable/Package/Chiller", "Welding - Split/Cassette",
    "Bearing Replacement",
    "Minor Breakdown - VRF", "Minor Breakdown - Ductable", "Minor Breakdown - Package",
    "Minor Breakdown - Chiller", "Minor Breakdown - Split", "Minor Breakdown - Cassette",
    "Minor Breakdown - AHU",
    "General Service - VRF", "General Service - Ductable", "General Service - Package",
    "General Service - Chiller", "General Service - Split", "General Service - Cassette",
    "General Service - AHU",
]

COMPLAINTS = [
    ("Compressor failure", ComplaintType.MAJOR_BREAKDOWN),
    ("Gas Leakage", ComplaintType.MAJOR_BREAKDOWN),
    ("PCB Problem", ComplaintType.MAJOR_BREAKDOWN),
    ("ODU Motor Problem", ComplaintType.MAJOR_BREAKDOWN),
    ("EXP Valve Problem", ComplaintType.MAJOR_BREAKDOWN),
    ("HP Switch Problem", ComplaintType.MAJOR_BREAKDOWN),
    ("IDU Motor Problem", ComplaintType.MINOR_BREAKDOWN),
    ("Sensor Problem", ComplaintType.MINOR_BREAKDOWN),
    ("Float Switch Problem", ComplaintType.MINOR_BREAKDOWN),
    ("Drain Pump Problem", ComplaintType.MINOR_BREAKDOWN),
    ("Water Leakage", ComplaintType.MINOR_BREAKDOWN),
    ("Noise Problem", ComplaintType.MINOR_BREAKDOWN),
    ("Smell Problem", ComplaintType.MINOR_BREAKDOWN),
    ("Others", ComplaintType.MINOR_BREAKDOWN),
    ("General Service", ComplaintType.MINOR_BREAKDOWN),
    ("Commissioning", ComplaintType.COMMISSIONING),
    ("Blower/Shaft Problem", ComplaintType.MAJOR_BREAKDOWN),
    ("General Complaint", ComplaintType.MAJOR_BREAKDOWN),
]

MATERIALS = [
    ("N2 Cylinder", "Nos"),
    ("O2 Cylinder", "Nos"),
    ("R410A Gas", "kg"),
    ("R22 Gas", "kg"),
    ("VRF Outdoor 10HP Fan Board", "Nos"),
    ("VRF Outdoor 14HP Fan Board", "Nos"),
    ("VRF 10HP Compressor Drive", "Nos"),
]


def _empty(session: Session, model) -> bool:
    return session.exec(select(model)).first() is None


def seed_master_data() -> None:
    with Session(engine) as session:
        if _empty(session, Skill):
            session.add_all([Skill(name=n) for n in SKILLS])
        if _empty(session, Complaint):
            session.add_all([Complaint(name=n, complaint_type=t) for n, t in COMPLAINTS])
        if _empty(session, MaterialItem):
            session.add_all([MaterialItem(name=n, uom=u) for n, u in MATERIALS])
        session.commit()


if __name__ == "__main__":
    from app.database import create_db_and_tables

    create_db_and_tables()
    seed_master_data()
    print("Seeded master data.")
