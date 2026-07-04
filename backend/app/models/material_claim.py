"""AMC material claim — Blue Star Ltd warranty replacement lifecycle.

One claim per material replaced under a ticket. The status is derived from which
milestone fields are filled (see services.material_claim.compute_claim_status):

  MR Raised → (in stock: used → replenished | not in stock: received → used)
            → Replaced → Defective in Office → Dispatched to BSL
"""

from datetime import date
from typing import Optional

from sqlmodel import Field, SQLModel

from app.core.enums import ClaimStatus


class MaterialClaim(SQLModel, table=True):
    __tablename__ = "material_claim"

    id: Optional[int] = Field(default=None, primary_key=True)
    claim_no: str = Field(index=True, unique=True)        # CLM+YYYYMMDD+nn
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    customer_id: Optional[int] = Field(default=None, foreign_key="customer.id", index=True)

    material_name: str = Field(index=True)
    uom: str
    qty: float
    in_stock: bool = Field(default=False)  # material on hand at MR time? drives the path order

    # Responsibility (decision: engineer = login user, technician = team member)
    engineer_user_id: Optional[int] = Field(default=None, foreign_key="app_user.id")
    technician_id: Optional[int] = Field(default=None, foreign_key="team_member.id")

    # 1. Material Request to BSL
    mr_no: Optional[str] = None
    mr_date: date

    # 2. Replacement / material received from BSL (Delivery Challan)
    delivery_challan_no: Optional[str] = None
    delivery_challan_date: Optional[date] = None

    # 3. Replacement fitted at site
    used_date: Optional[date] = None

    # 4. Defective unit returned to office (defective stock)
    defective_returned_date: Optional[date] = None

    # 5. Defective dispatched to BSL warehouse (Proof of Delivery)
    pod_no: Optional[str] = None
    pod_date: Optional[date] = None

    status: ClaimStatus = Field(default=ClaimStatus.MR_RAISED, index=True)
    remarks: Optional[str] = None
