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


def mr_pending_ticket_ids(session: Session) -> set[int]:
    """Tickets still waiting on material FROM Blue Star (drives the 'MR Pending' tag)."""
    return set(session.exec(
        select(MaterialClaim.ticket_id).where(
            MaterialClaim.status.in_(
                (
                    ClaimStatus.MR_RAISED,
                    ClaimStatus.MATERIAL_RECEIVED,
                    ClaimStatus.AWAITING_REPLENISH,
                )
            )
        )
    ).all())


def defective_pending_ticket_ids(session: Session) -> set[int]:
    """Tickets whose replacement is fitted but the defective unit is still owed to BSL.

    Work is complete (``used_date`` set — replaced from own stock or from a BSL claim) yet no
    POD has been raised, so the defective part has not gone back to Blue Star. Drives the
    "Defective Part" tag and the Material Return KPI.
    """
    return set(session.exec(
        select(MaterialClaim.ticket_id).where(
            MaterialClaim.used_date.is_not(None),
            MaterialClaim.pod_no.is_(None),
        )
    ).all())


def defective_in_office_claims(session: Session) -> list[MaterialClaim]:
    """Claims whose defective unit is back at the office but not yet dispatched to BSL.

    Status 'Defective in Office' (defective_returned_date set, no POD yet) — physical stock
    sitting at the office that needs sending to the BSL warehouse. Oldest waiting first.
    """
    return list(session.exec(
        select(MaterialClaim).where(
            MaterialClaim.defective_returned_date.is_not(None),
            MaterialClaim.pod_no.is_(None),
        ).order_by(MaterialClaim.defective_returned_date)
    ).all())


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
