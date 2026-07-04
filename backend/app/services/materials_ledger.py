"""Materials ledger logic: document numbering and global stock calculation."""

from datetime import date

from sqlmodel import Session, func, select

from app.core.enums import IssueOutcome
from app.models.material_claim import MaterialClaim
from app.models.material_ledger import MaterialInward, MaterialIssue


def _next_doc_no(session: Session, model, no_field, prefix: str, on_date: date) -> str:
    """PREFIX + YYYYMMDD + 2-digit running number per day (per document type)."""
    datestr = on_date.strftime("%Y%m%d")
    count = session.exec(
        select(func.count())
        .select_from(model)
        .where(func.substr(no_field, len(prefix) + 1, 8) == datestr)
    ).one()
    return f"{prefix}{datestr}{count + 1:02d}"


def next_inward_no(session: Session, on_date: date) -> str:
    return _next_doc_no(session, MaterialInward, MaterialInward.inward_no, "IN", on_date)


def next_issue_no(session: Session, on_date: date) -> str:
    return _next_doc_no(session, MaterialIssue, MaterialIssue.issue_no, "ISS", on_date)


def next_delivery_note_no(session: Session, on_date: date) -> str:
    """Count issues that already carry a delivery note for the date."""
    datestr = on_date.strftime("%Y%m%d")
    count = session.exec(
        select(func.count())
        .select_from(MaterialIssue)
        .where(MaterialIssue.delivery_note_no.is_not(None))
        .where(func.substr(MaterialIssue.delivery_note_no, 3, 8) == datestr)
    ).one()
    return f"DN{datestr}{count + 1:02d}"


def stock_levels(session: Session) -> list[dict]:
    """Per-material global stock: received, consumed (Used), available, and pending allocations.

    available = received − consumed.  Not-Used issues never consume; pending (Allocated, no
    outcome) are reported separately as a reservation hint, not subtracted from available.
    """
    def _row(name: str, uom: str) -> dict:
        return received.setdefault(
            name, {"material_name": name, "uom": uom, "received": 0.0,
                   "consumed": 0.0, "allocated_pending": 0.0, "on_claim": 0.0}
        )

    received: dict[str, dict] = {}
    for inw in session.exec(select(MaterialInward)).all():
        _row(inw.material_name, inw.uom)["received"] += inw.qty

    for iss in session.exec(select(MaterialIssue)).all():
        row = _row(iss.material_name, iss.uom)
        if iss.outcome == IssueOutcome.USED:
            row["consumed"] += iss.qty
        elif iss.outcome is None:  # Allocated but not yet delivered/returned
            row["allocated_pending"] += iss.qty

    # Parts pulled from office stock on an AMC claim, awaiting BSL replenishment.
    for clm in session.exec(
        select(MaterialClaim).where(MaterialClaim.in_stock == True)  # noqa: E712
    ).all():
        if clm.used_date is not None and not clm.delivery_challan_no:
            _row(clm.material_name, clm.uom)["on_claim"] += clm.qty

    result = []
    for row in received.values():
        row["available"] = row["received"] - row["consumed"] - row["on_claim"]
        result.append(row)
    return sorted(result, key=lambda r: r["material_name"])
