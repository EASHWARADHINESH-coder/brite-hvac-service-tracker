"""Excel (.xlsx) exports for Tickets, PMS, Customers, Materials (Stock & Blue Star Claims).

Each endpoint applies the page's filters (and, where a natural date exists, a
Start/End date range), builds a workbook, and streams it as a download.
Reporting exports are restricted to Service Admin / Service Engineer.
"""

from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlmodel import select

from app.api.deps import SessionDep, require_engineer
from app.core.enums import ClaimStatus, TicketStatus, WorkType
from app.models.masters import Customer
from app.models.material_claim import MaterialClaim
from app.models.pms import PMS
from app.models.tickets import Ticket, TicketUpdate
from app.services.excel_export import build_workbook
from app.services.materials_ledger import stock_levels

router = APIRouter(
    prefix="/exports",
    tags=["exports"],
    dependencies=[Depends(require_engineer)],
)

_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx(sheets, filename: str) -> Response:
    return Response(
        content=build_workbook(sheets),
        media_type=_MEDIA,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _customer_names(session) -> dict[int, str]:
    return {c.id: c.name for c in session.exec(select(Customer)).all()}


@router.get("/tickets")
def export_tickets(
    session: SessionDep,
    start: date | None = None,
    end: date | None = None,
    status: TicketStatus | None = None,
    work_type: WorkType | None = None,
):
    """Tickets export — 3 sheets: summary, lifecycle history, linked claims."""
    stmt = select(Ticket)
    if start:
        stmt = stmt.where(Ticket.complaint_date >= start)
    if end:
        stmt = stmt.where(Ticket.complaint_date <= end)
    if status:
        stmt = stmt.where(Ticket.status == status)
    if work_type:
        stmt = stmt.where(Ticket.work_type == work_type)
    tickets = session.exec(stmt.order_by(Ticket.ticket_no.desc())).all()

    cust = _customer_names(session)
    tno = {t.id: t.ticket_no for t in tickets}

    summary = [
        [
            t.ticket_no, cust.get(t.customer_id, t.customer_id), t.complaint_date,
            t.work_type.value, t.machine_type.value, t.skill or "",
            t.status.value, "Yes" if t.reopen else "No",
        ]
        for t in tickets
    ]
    summary_sheet = (
        "Tickets",
        ["Ticket No", "Customer", "Complaint Date", "Work Type", "Machine",
         "Skill", "Status", "Reopened"],
        summary,
    )

    # Lifecycle history — one row per stage update for the filtered tickets.
    lifecycle_rows = []
    for t in tickets:
        for u in sorted(t.updates, key=lambda x: x.id or 0):
            lifecycle_rows.append([
                t.ticket_no, u.stage.value, u.action_date, u.job_lead or "",
                ", ".join(m.name for m in u.team), u.complaints or "",
                u.materials or "", u.start_date, u.end_date, u.status.value,
                u.remarks or "", "Yes" if u.reopen else "No", u.reopen_reason or "",
            ])
    lifecycle_sheet = (
        "Lifecycle",
        ["Ticket No", "Stage", "Date", "Job Lead", "Team", "Complaint", "Materials",
         "Start Date", "End Date", "Status", "Remarks", "Reopen", "Reopen Reason"],
        lifecycle_rows,
    )

    # Linked Blue Star claims for the filtered tickets.
    claim_rows = []
    if tickets:
        claims = session.exec(
            select(MaterialClaim).where(MaterialClaim.ticket_id.in_(list(tno.keys())))
            .order_by(MaterialClaim.claim_no)
        ).all()
        claim_rows = [
            [
                c.claim_no, tno.get(c.ticket_id, c.ticket_id), c.material_name,
                c.qty, c.uom, "In stock" if c.in_stock else "Procure",
                c.status.value, c.mr_no or "", c.mr_date,
                c.delivery_challan_no or "", c.delivery_challan_date,
                c.used_date, c.defective_returned_date, c.pod_no or "", c.pod_date,
            ]
            for c in claims
        ]
    claims_sheet = (
        "Claims",
        ["Claim No", "Ticket No", "Material", "Qty", "UoM", "Path", "Status",
         "MR No", "MR Date", "Challan No", "Challan Date", "Used Date",
         "Defective Returned", "POD No", "POD Date"],
        claim_rows,
    )

    return _xlsx([summary_sheet, lifecycle_sheet, claims_sheet], "tickets.xlsx")


@router.get("/pms")
def export_pms(
    session: SessionDep,
    start: date | None = None,
    end: date | None = None,
    customer_id: int | None = None,
):
    """PMS export — date range filters on WO start date."""
    stmt = select(PMS)
    if start:
        stmt = stmt.where(PMS.wo_start_date >= start)
    if end:
        stmt = stmt.where(PMS.wo_start_date <= end)
    if customer_id:
        stmt = stmt.where(PMS.customer_id == customer_id)
    rows_db = session.exec(stmt.order_by(PMS.wo_number)).all()

    cust = _customer_names(session)
    rows = [
        [
            cust.get(p.customer_id, p.customer_id), p.wo_number, p.schedule or "",
            p.wo_start_date, p.wo_end_date,
            p.schedule_1, p.schedule_2, p.schedule_3,
            p.schedule_4, p.schedule_5, p.schedule_6,
        ]
        for p in rows_db
    ]
    sheet = (
        "PMS",
        ["Customer", "WO No", "Schedule", "WO Start", "WO End",
         "Schedule 1", "Schedule 2", "Schedule 3", "Schedule 4", "Schedule 5", "Schedule 6"],
        rows,
    )
    return _xlsx([sheet], "pms.xlsx")


@router.get("/customers")
def export_customers(
    session: SessionDep,
    q: str | None = Query(None, description="Name search"),
    amc_only: bool = False,
):
    """Customers export — no date range (customers have no date)."""
    stmt = select(Customer)
    if q:
        stmt = stmt.where(Customer.name.ilike(f"%{q}%"))
    if amc_only:
        stmt = stmt.where(Customer.is_amc == True)  # noqa: E712
    customers = session.exec(stmt.order_by(Customer.name)).all()

    rows = [
        [
            c.name, c.address or "", c.city or "", c.pincode or "",
            c.contact_person or "", c.contact_number or "", c.secondary_mobile or "",
            c.mail_id or "", "Yes" if c.is_amc else "No",
        ]
        for c in customers
    ]
    sheet = (
        "Customers",
        ["Name", "Address", "City", "Pincode", "Contact Person",
         "Primary Mobile", "Secondary Mobile", "Email", "AMC"],
        rows,
    )
    return _xlsx([sheet], "customers.xlsx")


@router.get("/materials/stock")
def export_stock(session: SessionDep):
    """Materials stock export — running snapshot, no date range."""
    rows = [
        [
            s["material_name"], s["uom"], s["received"], s["consumed"],
            s["on_claim"], s["available"], s["allocated_pending"],
        ]
        for s in stock_levels(session)
    ]
    sheet = (
        "Stock",
        ["Material", "UoM", "Received", "Consumed", "On Claim", "Available", "Allocated (Pending)"],
        rows,
    )
    return _xlsx([sheet], "materials_stock.xlsx")


@router.get("/materials/claims")
def export_claims(
    session: SessionDep,
    start: date | None = None,
    end: date | None = None,
    status: ClaimStatus | None = None,
    ticket_no: str | None = None,
):
    """Blue Star material claims export — date range filters on MR date."""
    stmt = select(MaterialClaim)
    if start:
        stmt = stmt.where(MaterialClaim.mr_date >= start)
    if end:
        stmt = stmt.where(MaterialClaim.mr_date <= end)
    if status:
        stmt = stmt.where(MaterialClaim.status == status)
    claims = session.exec(stmt.order_by(MaterialClaim.claim_no.desc())).all()

    cust = _customer_names(session)
    tno = {t.id: t.ticket_no for t in session.exec(select(Ticket)).all()}
    if ticket_no:
        needle = ticket_no.lower()
        claims = [c for c in claims if needle in str(tno.get(c.ticket_id, "")).lower()]

    rows = [
        [
            c.claim_no, tno.get(c.ticket_id, c.ticket_id),
            cust.get(c.customer_id, "") if c.customer_id else "",
            c.material_name, c.qty, c.uom, "In stock" if c.in_stock else "Procure",
            c.status.value, c.mr_no or "", c.mr_date,
            c.delivery_challan_no or "", c.delivery_challan_date,
            c.used_date, c.defective_returned_date, c.pod_no or "", c.pod_date,
            c.remarks or "",
        ]
        for c in claims
    ]
    sheet = (
        "Blue Star Claims",
        ["Claim No", "Ticket No", "Customer", "Material", "Qty", "UoM", "Path",
         "Status", "MR No", "MR Date", "Challan No", "Challan Date", "Used Date",
         "Defective Returned", "POD No", "POD Date", "Remarks"],
        rows,
    )
    return _xlsx([sheet], "blue_star_claims.xlsx")
