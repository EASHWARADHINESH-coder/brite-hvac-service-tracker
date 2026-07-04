"""AMC material-claim logic: claim numbering and status derivation.

The claim status is computed from which milestone fields are filled, so it works for
both paths (in-stock: use→replenish, not-in-stock: receive→use) without a rigid state machine.
"""

from datetime import date

from sqlmodel import Session, func, select

from app.core.enums import ClaimStatus
from app.models.material_claim import MaterialClaim


def next_claim_no(session: Session, on_date: date) -> str:
    """CLM + YYYYMMDD + 2-digit running number per day."""
    datestr = on_date.strftime("%Y%m%d")
    count = session.exec(
        select(func.count())
        .select_from(MaterialClaim)
        .where(func.substr(MaterialClaim.claim_no, 4, 8) == datestr)
    ).one()
    return f"CLM{datestr}{count + 1:02d}"


def compute_claim_status(claim: MaterialClaim) -> ClaimStatus:
    """Derive the lifecycle stage from recorded milestone fields."""
    if claim.pod_no:
        return ClaimStatus.DISPATCHED
    if claim.defective_returned_date is not None:
        return ClaimStatus.DEFECTIVE_RETURNED
    if claim.used_date is not None:
        # In-stock parts are used first, then replenished by BSL (challan).
        if claim.in_stock and not claim.delivery_challan_no:
            return ClaimStatus.AWAITING_REPLENISH
        return ClaimStatus.REPLACED
    if claim.delivery_challan_no:
        # Not-in-stock: material received from BSL, not yet fitted.
        return ClaimStatus.MATERIAL_RECEIVED
    return ClaimStatus.MR_RAISED
