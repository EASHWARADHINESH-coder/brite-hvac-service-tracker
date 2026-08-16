"""Tickets + lifecycle updates.

Creating a ticket auto-assigns the ticket number, derives the skill from the primary complaint,
and seeds the first lifecycle row (Logged). Appending updates recomputes the ticket status and,
for reopens, keeps the same ticket number (new lifecycle chain) per the locked decision.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status as http_status
from sqlmodel import func, select

from app.api.deps import CurrentUser, SessionDep, get_current_user, require_admin, require_engineer
from app.core.enums import (
    WORK_TYPE_PREFIX,
    ClaimStatus,
    LifecycleStage,
    TicketStatus,
    UserRole,
    WorkType,
)
from app.models.masters import Complaint, Customer, MaterialItem, TeamMember
from app.models.material_claim import MaterialClaim
from app.models.payment import Payment
from app.models.ticket_edit import TicketEdit
from app.models.tickets import Ticket, TicketUpdate
from app.models.user import User
from app.schemas.tickets import (
    MaterialPendingCreate,
    TeamMemberBrief,
    TicketBill,
    TicketCancel,
    TicketCommissioning,
    TicketCreate,
    TicketStar,
    TicketDetail,
    TicketEditRead,
    TicketPatch,
    TicketRead,
    TicketUpdateCreate,
    TicketUpdateRead,
    WorkStartedCreate,
)
from app.services.ai import indexing
from app.services.notifications import notify
from app.services.material_claim import (
    compute_claim_status,
    defective_pending_ticket_ids,
    mr_pending_ticket_ids,
    next_claim_no,
)
from app.services.permissions import (
    can_view_ticket,
    has_org_scope,
    is_privileged,
    owned_ticket_ids,
)
from app.services.ticket_logic import (
    assign_by_date,
    assignment_overdue,
    compute_ticket_status,
    derive_skill,
    is_assigned,
    is_commissioning_ticket,
    next_ticket_no,
    primary_complaint_of,
    requires_tc,
    resolve_status,
)

router = APIRouter(prefix="/tickets", tags=["tickets"], dependencies=[Depends(get_current_user)])


def _update_to_read(u: TicketUpdate) -> TicketUpdateRead:
    return TicketUpdateRead(
        id=u.id,
        ticket_id=u.ticket_id,
        stage=u.stage,
        action_date=u.action_date,
        job_lead=u.job_lead,
        complaints=u.complaints,
        materials=u.materials,
        start_date=u.start_date,
        end_date=u.end_date,
        status=u.status,
        remarks=u.remarks,
        reopen=u.reopen,
        reopen_reason=u.reopen_reason,
        team=[TeamMemberBrief(id=m.id, name=m.name) for m in u.team],
    )


@router.get("", response_model=list[TicketRead])
def list_tickets(
    session: SessionDep,
    user: CurrentUser,
    status: TicketStatus | None = None,
    work_type: WorkType | None = None,
    customer_id: int | None = None,
    q: str | None = Query(None, description="Match ticket number"),
    mr_pending: bool | None = Query(None, description="Only tickets awaiting BSL material"),
    defective_pending: bool | None = Query(
        None, description="Only tickets with a defective part still owed to BSL"
    ),
):
    stmt = select(Ticket)
    if status:
        stmt = stmt.where(Ticket.status == status)
    if work_type:
        stmt = stmt.where(Ticket.work_type == work_type)
    if customer_id:
        stmt = stmt.where(Ticket.customer_id == customer_id)
    if q:
        stmt = stmt.where(Ticket.ticket_no.ilike(f"%{q}%"))
    if mr_pending:
        ids = mr_pending_ticket_ids(session)
        if not ids:
            return []
        stmt = stmt.where(Ticket.id.in_(ids))
    if defective_pending:
        ids = defective_pending_ticket_ids(session)
        if not ids:
            return []
        stmt = stmt.where(Ticket.id.in_(ids))
    # Task-scoped roles only see their own tickets (MD reads org-wide).
    if not has_org_scope(user):
        owned = owned_ticket_ids(session, user)
        if not owned:
            return []
        stmt = stmt.where(Ticket.id.in_(owned))
    # "Recent" = newest by date + running number (ignore the work-type prefix B/S/R/P).
    tickets = session.exec(
        stmt.order_by(func.substr(Ticket.ticket_no, 2).desc())
    ).all()
    customers = {c.id: c for c in session.exec(select(Customer)).all()}
    open_claims = mr_pending_ticket_ids(session)
    defective = defective_pending_ticket_ids(session)
    return [
        _ticket_read(
            t,
            customers[t.customer_id].name if t.customer_id in customers else None,
            _payment_fields(session, t),
            customer_city=customers[t.customer_id].city if t.customer_id in customers else None,
            mr_pending=t.id in open_claims,
            defective_pending=t.id in defective,
        )
        for t in tickets
    ]


@router.post("", response_model=TicketDetail, status_code=201, dependencies=[Depends(require_engineer)])
def create_ticket(payload: TicketCreate, session: SessionDep):
    customer = session.get(Customer, payload.customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")

    # Derive skill from the primary complaint's type, if supplied.
    skill = None
    if payload.primary_complaint:
        complaint = session.exec(
            select(Complaint).where(Complaint.name == payload.primary_complaint)
        ).first()
        if not complaint:
            raise HTTPException(400, f"Unknown complaint '{payload.primary_complaint}'")
        skill = (
            derive_skill(complaint.complaint_type.value, payload.machine_type)
            if payload.machine_type
            else complaint.complaint_type.value
        )

    # A manual skill override (if provided) wins over the derived value.
    if payload.skill:
        skill = payload.skill.strip()

    # Repaired Service requires a total amount for payment follow-up.
    total_amount = None
    if payload.work_type == WorkType.REPAIRED_SERVICE:
        if payload.total_amount is None:
            raise HTTPException(400, "Total amount is required for Repaired Service")
        total_amount = payload.total_amount
        if payload.advance_amount and payload.advance_amount > total_amount:
            raise HTTPException(400, "Advance cannot exceed the total amount")

    ticket = Ticket(
        ticket_no=next_ticket_no(session, payload.work_type, payload.complaint_date),
        customer_id=payload.customer_id,
        complaint_date=payload.complaint_date,
        work_type=payload.work_type,
        machine_type=payload.machine_type,
        skill=skill,
        total_amount=total_amount,
        status=TicketStatus.OPEN,
    )
    session.add(ticket)
    session.commit()
    session.refresh(ticket)

    # Seed the first lifecycle row (Logged).
    logged = TicketUpdate(
        ticket_id=ticket.id,
        stage=LifecycleStage.LOGGED,
        action_date=payload.complaint_date,
        complaints=payload.primary_complaint,
        remarks=payload.remarks,
        status=TicketStatus.OPEN,
    )
    session.add(logged)
    # Record the advance as the first payment.
    if total_amount is not None and payload.advance_amount and payload.advance_amount > 0:
        session.add(Payment(
            ticket_id=ticket.id,
            amount=payload.advance_amount,
            paid_date=payload.complaint_date,
            is_advance=True,
            remarks="Advance",
        ))
    session.commit()
    session.refresh(ticket)

    indexing.ticket_changed(ticket.id)
    return _ticket_detail(session, ticket)


@router.patch("/{ticket_id}", response_model=TicketDetail, dependencies=[Depends(require_engineer)])
def edit_ticket(ticket_id: int, payload: TicketPatch, session: SessionDep, user: CurrentUser):
    """Correct a ticket's core fields after creation (customer / work type / primary complaint).

    Changing the work type re-prefixes the ticket number (keeping the date + running number,
    since the sequence is per-date not per-type, e.g. B2026070303 -> S2026070303). Each edit is
    logged as a lightweight note; the lifecycle timeline is left untouched.
    """
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")

    changes: list[str] = []

    if payload.customer_id is not None and payload.customer_id != ticket.customer_id:
        new_cust = session.get(Customer, payload.customer_id)
        if not new_cust:
            raise HTTPException(404, "Customer not found")
        old_cust = session.get(Customer, ticket.customer_id)
        changes.append(f"Customer: {old_cust.name if old_cust else '-'} -> {new_cust.name}")
        ticket.customer_id = payload.customer_id

    if payload.work_type is not None and payload.work_type != ticket.work_type:
        old_no = ticket.ticket_no
        # Re-prefix: swap the leading letter, keep the YYYYMMDD + running number.
        new_no = WORK_TYPE_PREFIX[payload.work_type] + old_no[1:]
        if session.exec(select(Ticket).where(Ticket.ticket_no == new_no, Ticket.id != ticket.id)).first():
            # Defensive: extremely unlikely (sequence is unique per date), fall back to a fresh no.
            new_no = next_ticket_no(session, payload.work_type, ticket.complaint_date)
        changes.append(f"Work type: {ticket.work_type.value} -> {payload.work_type.value} ({old_no} -> {new_no})")
        ticket.work_type = payload.work_type
        ticket.ticket_no = new_no

    if payload.primary_complaint is not None:
        logged = next(
            (u for u in sorted(ticket.updates, key=lambda u: u.id or 0)
             if u.stage == LifecycleStage.LOGGED), None,
        )
        current = logged.complaints if logged else None
        if payload.primary_complaint != (current or ""):
            complaint = session.exec(
                select(Complaint).where(Complaint.name == payload.primary_complaint)
            ).first()
            if payload.primary_complaint and not complaint:
                raise HTTPException(400, f"Unknown complaint '{payload.primary_complaint}'")
            changes.append(f"Complaint: {current or '-'} -> {payload.primary_complaint or '-'}")
            if logged is not None:
                logged.complaints = payload.primary_complaint or None
                session.add(logged)
            # Re-derive the skill from the new complaint type + existing machine type.
            if complaint:
                ticket.skill = (
                    derive_skill(complaint.complaint_type.value, ticket.machine_type)
                    if ticket.machine_type else complaint.complaint_type.value
                )

    if not changes:
        return _ticket_detail(session, ticket)

    session.add(ticket)
    session.add(TicketEdit(ticket_id=ticket.id, note="; ".join(changes), edited_by_user_id=user.id))
    session.commit()
    session.refresh(ticket)
    indexing.ticket_changed(ticket.id)
    return _ticket_detail(session, ticket)


@router.post("/{ticket_id}/cancel", response_model=TicketDetail, dependencies=[Depends(require_admin)])
def cancel_ticket(ticket_id: int, payload: TicketCancel, session: SessionDep, user: CurrentUser):
    """Cancel a ticket (Admin only). Blocked for tickets with a Blue Star MR claim. The ticket
    number is retained (never reused); the ticket cannot be reopened afterwards."""
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if not payload.reason or not payload.reason.strip():
        raise HTTPException(400, "A cancellation reason is required")
    if ticket.status == TicketStatus.CANCELLED:
        raise HTTPException(409, "Ticket is already cancelled")
    if ticket.status == TicketStatus.CLOSED:
        raise HTTPException(409, "A closed ticket can't be cancelled")
    # Only non-MR tickets can be cancelled (locked decision Q1.2).
    has_claim = session.exec(
        select(MaterialClaim).where(MaterialClaim.ticket_id == ticket_id)
    ).first()
    if has_claim:
        raise HTTPException(400, "This ticket has a Blue Star MR claim and can't be cancelled")

    ticket.status = TicketStatus.CANCELLED
    ticket.cancel_reason = payload.reason.strip()
    session.add(ticket)
    session.add(TicketEdit(
        ticket_id=ticket.id, note=f"Cancelled: {payload.reason.strip()}", edited_by_user_id=user.id,
    ))
    session.commit()
    session.refresh(ticket)
    indexing.ticket_changed(ticket.id)
    return _ticket_detail(session, ticket)


@router.put("/{ticket_id}/bill", response_model=TicketDetail, dependencies=[Depends(require_engineer)])
def set_bill(ticket_id: int, payload: TicketBill, session: SessionDep, user: CurrentUser):
    """Set/update manual billing (bill number + date + remarks) for a Repaired Service ticket.

    Works retroactively on old tickets. Only Repaired Service tickets carry billing.
    """
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if ticket.work_type != WorkType.REPAIRED_SERVICE:
        raise HTTPException(400, "Billing applies only to Repaired Service tickets")

    bill_no = (payload.bill_no or "").strip() or None
    ticket.bill_no = bill_no
    ticket.bill_date = payload.bill_date
    ticket.bill_remarks = (payload.bill_remarks or "").strip() or None
    session.add(ticket)
    note = f"Billed: {bill_no}" + (f" ({payload.bill_date})" if payload.bill_date else "") \
        if bill_no else "Billing cleared"
    session.add(TicketEdit(ticket_id=ticket.id, note=note, edited_by_user_id=user.id))
    session.commit()
    session.refresh(ticket)
    return _ticket_detail(session, ticket)


@router.put("/{ticket_id}/commissioning", response_model=TicketDetail,
            dependencies=[Depends(require_engineer)])
def set_commissioning(ticket_id: int, payload: TicketCommissioning, session: SessionDep,
                      user: CurrentUser):
    """Set/update the free-text installation (commissioning) report — status + remarks.

    Only for tickets whose primary complaint type is Commissioning. The PDF is uploaded
    separately via the reports endpoint with category="commissioning".
    """
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    updates = session.exec(
        select(TicketUpdate).where(TicketUpdate.ticket_id == ticket_id)
    ).all()
    if not is_commissioning_ticket(session, updates):
        raise HTTPException(400, "This ticket's primary complaint is not a Commissioning type")

    ticket.commissioning_status = (payload.status or "").strip() or None
    ticket.commissioning_remarks = (payload.remarks or "").strip() or None
    session.add(ticket)
    session.add(TicketEdit(
        ticket_id=ticket.id, note="Installation report updated", edited_by_user_id=user.id,
    ))
    session.commit()
    session.refresh(ticket)
    return _ticket_detail(session, ticket)


@router.put("/{ticket_id}/star", response_model=TicketDetail,
            dependencies=[Depends(require_engineer)])
def set_star(ticket_id: int, payload: TicketStar, session: SessionDep, user: CurrentUser):
    """Star / unstar a ticket as important (boosts it in the dashboard priority list)."""
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    ticket.starred = payload.starred
    session.add(ticket)
    session.add(TicketEdit(
        ticket_id=ticket.id,
        note="Marked important" if payload.starred else "Unmarked important",
        edited_by_user_id=user.id,
    ))
    session.commit()
    session.refresh(ticket)
    return _ticket_detail(session, ticket)


@router.get("/{ticket_id}", response_model=TicketDetail)
def get_ticket(ticket_id: int, session: SessionDep, user: CurrentUser):
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if not can_view_ticket(session, user, ticket_id):
        raise HTTPException(http_status.HTTP_403_FORBIDDEN, "Not your task")
    indexing.ticket_changed(ticket.id)
    return _ticket_detail(session, ticket)


@router.post("/{ticket_id}/updates", response_model=TicketDetail, status_code=201)
def add_update(
    ticket_id: int, payload: TicketUpdateCreate, session: SessionDep, user: CurrentUser
):
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")

    # Service Admin/Engineer: any ticket. Technician: only their own. Helper: never (view only).
    if not is_privileged(user):
        if user.role != UserRole.TECHNICIAN:
            raise HTTPException(http_status.HTTP_403_FORBIDDEN, "View-only role")
        if ticket_id not in owned_ticket_ids(session, user):
            raise HTTPException(http_status.HTTP_403_FORBIDDEN, "Not your task")

    # Cancelled is terminal — no further updates and no reopen (locked decision Q1.4).
    if ticket.status == TicketStatus.CANCELLED:
        raise HTTPException(409, "Cancelled tickets can't be modified")

    # Note: closing is intentionally NOT blocked by an unresolved Blue Star claim — the field
    # work can finish before the paperwork. Such tickets surface an "MR Pending" tag instead
    # (see mr_pending on TicketRead) so the claim isn't forgotten.
    update = TicketUpdate(
        ticket_id=ticket.id,
        stage=payload.stage,
        action_date=payload.action_date,
        job_lead=payload.job_lead,
        complaints=payload.complaints,
        materials=payload.materials,
        start_date=payload.start_date,
        end_date=payload.end_date,
        remarks=payload.remarks,
        reopen=payload.reopen,
        reopen_reason=payload.reopen_reason,
        status=resolve_status(payload.end_date, payload.reopen),
    )
    if payload.team_ids:
        members = session.exec(
            select(TeamMember).where(TeamMember.id.in_(payload.team_ids))
        ).all()
        update.team = list(members)

    session.add(update)
    session.commit()

    # Recompute ticket-level status from the full lifecycle chain.
    session.refresh(ticket)
    ticket.status = compute_ticket_status(ticket.updates)
    ticket.reopen = any(u.reopen for u in ticket.updates)
    session.add(ticket)
    session.commit()
    session.refresh(ticket)

    # Notify the assigned job lead (if that team member is linked to a user account).
    if payload.job_lead:
        lead_member = session.exec(
            select(TeamMember).where(TeamMember.name == payload.job_lead)
        ).first()
        if lead_member:
            lead_user = session.exec(
                select(User).where(User.team_member_id == lead_member.id)
            ).first()
            if lead_user and lead_user.id != user.id:
                notify(
                    session, lead_user.id, "ticket_assigned",
                    title=f"Ticket assigned to you: {ticket.ticket_no}",
                    body=f"You're the job lead ({payload.stage.value})",
                    link=f"/tickets/{ticket.id}",
                )

    indexing.ticket_changed(ticket.id)
    return _ticket_detail(session, ticket)


@router.post("/{ticket_id}/material-pending", response_model=TicketDetail, status_code=201)
def raise_material_pending(
    ticket_id: int, payload: MaterialPendingCreate, session: SessionDep, user: CurrentUser
):
    """Blue Star branch (atomic): create the claim, save a manual material to the
    catalog, and move the ticket to Material Pending — all in one transaction."""
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if not is_privileged(user):
        if user.role != UserRole.TECHNICIAN or ticket_id not in owned_ticket_ids(session, user):
            raise HTTPException(http_status.HTTP_403_FORBIDDEN, "Not your task")

    name = payload.material_name.strip()
    if not name:
        raise HTTPException(400, "Material name is required")
    if payload.technician_id and not session.get(TeamMember, payload.technician_id):
        raise HTTPException(404, "Technician not found")

    mr_date = payload.action_date or date.today()

    # Save a new material to the catalog for future MRs (case-insensitive dedupe).
    exists = session.exec(
        select(MaterialItem).where(func.lower(MaterialItem.name) == name.lower())
    ).first()
    if not exists:
        session.add(MaterialItem(name=name, uom=payload.uom or "Nos"))

    claim = MaterialClaim(
        claim_no=next_claim_no(session, mr_date),
        ticket_id=ticket_id,
        customer_id=ticket.customer_id,
        material_name=name,
        uom=payload.uom or "Nos",
        qty=payload.qty,
        in_stock=payload.in_stock,
        technician_id=payload.technician_id,
        mr_no=payload.mr_no,
        mr_date=mr_date,
    )
    claim.status = compute_claim_status(claim)
    session.add(claim)

    mr_txt = f" (SAP MR {payload.mr_no})" if payload.mr_no else ""
    session.add(TicketUpdate(
        ticket_id=ticket_id,
        stage=LifecycleStage.MATERIAL_PENDING,
        action_date=mr_date,
        materials=f"BSL MR Pending - {name} x{payload.qty}{mr_txt} - claim {claim.claim_no}",
        remarks=payload.remarks,
        status=TicketStatus.OPEN,
    ))

    session.commit()
    session.refresh(ticket)
    ticket.status = compute_ticket_status(ticket.updates)
    session.add(ticket)
    session.commit()
    session.refresh(ticket)
    session.refresh(claim)
    indexing.ticket_changed(ticket.id)
    indexing.claim_changed(claim.id)
    return _ticket_detail(session, ticket)


@router.post("/{ticket_id}/work-started", response_model=TicketDetail, status_code=201)
def record_work_started(
    ticket_id: int, payload: WorkStartedCreate, session: SessionDep, user: CurrentUser
):
    """Record Work Started with any number of spares, in one transaction.

    Every BSL spare raises its own Blue Star claim (and is saved to the materials catalog for
    future MRs); non-BSL spares are recorded on the lifecycle row. Exactly one lifecycle row is
    written: Material Pending when any claim was raised, otherwise Work Started. `close_now`
    closes the ticket in the same call, and is ignored when a claim is pending.
    """
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if not is_privileged(user):
        if user.role != UserRole.TECHNICIAN:
            raise HTTPException(http_status.HTTP_403_FORBIDDEN, "View-only role")
        if ticket_id not in owned_ticket_ids(session, user):
            raise HTTPException(http_status.HTTP_403_FORBIDDEN, "Not your task")

    action_date = payload.action_date or date.today()
    for s in payload.spares:
        if not s.material_name.strip():
            raise HTTPException(400, "Every spare needs a material name")
    bsl = [s for s in payload.spares if s.source == "bsl"]
    non_bsl = [s for s in payload.spares if s.source != "bsl"]
    for s in bsl:
        if s.technician_id and not session.get(TeamMember, s.technician_id):
            raise HTTPException(404, "Technician not found")

    notes: list[str] = []
    claim_ids: list[int] = []

    for s in bsl:
        name = s.material_name.strip()
        known = session.exec(
            select(MaterialItem).where(func.lower(MaterialItem.name) == name.lower())
        ).first()
        if not known:
            session.add(MaterialItem(name=name, uom=s.uom or "Nos"))
        claim = MaterialClaim(
            claim_no=next_claim_no(session, action_date),
            ticket_id=ticket_id,
            customer_id=ticket.customer_id,
            material_name=name,
            uom=s.uom or "Nos",
            qty=s.qty,
            in_stock=s.in_stock,
            technician_id=s.technician_id,
            mr_no=s.mr_no,
            mr_date=action_date,
        )
        claim.status = compute_claim_status(claim)
        session.add(claim)
        session.flush()  # so the next claim number accounts for this one
        claim_ids.append(claim.id)
        mr_txt = f" (SAP MR {s.mr_no})" if s.mr_no else ""
        notes.append(f"BSL MR Pending - {name} x{s.qty:g}{mr_txt} - claim {claim.claim_no}")

    for s in non_bsl:
        vendor = f" ({s.vendor.strip()})" if s.vendor and s.vendor.strip() else ""
        notes.append(f"Vendor/Supplier{vendor} - {s.material_name.strip()} x{s.qty:g}")

    # Crew present for this stage (item 4/5): carry the team forward per-stage so the WIP
    # report and the timeline record who was on site each day, not just at assignment.
    work_team: list[TeamMember] = []
    if payload.team_ids:
        work_team = list(session.exec(
            select(TeamMember).where(TeamMember.id.in_(payload.team_ids))
        ).all())

    work_update = TicketUpdate(
        ticket_id=ticket_id,
        stage=LifecycleStage.MATERIAL_PENDING if bsl else LifecycleStage.WORK_STARTED,
        action_date=action_date,
        materials=" | ".join(notes) if notes else "None",
        remarks=payload.remarks,
        status=TicketStatus.OPEN,
    )
    work_update.team = work_team
    session.add(work_update)

    if payload.close_now and not bsl:
        end = payload.end_date or action_date
        session.add(TicketUpdate(
            ticket_id=ticket_id,
            stage=LifecycleStage.CLOSED,
            action_date=end,
            end_date=end,
            remarks=payload.remarks,
            status=TicketStatus.CLOSED,
        ))

    session.commit()
    session.refresh(ticket)
    ticket.status = compute_ticket_status(ticket.updates)
    session.add(ticket)
    session.commit()
    session.refresh(ticket)
    indexing.ticket_changed(ticket.id)
    for cid in claim_ids:
        indexing.claim_changed(cid)
    return _ticket_detail(session, ticket)


@router.get("/{ticket_id}/updates", response_model=list[TicketUpdateRead])
def list_updates(ticket_id: int, session: SessionDep, user: CurrentUser):
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if not can_view_ticket(session, user, ticket_id):
        raise HTTPException(http_status.HTTP_403_FORBIDDEN, "Not your task")
    return [_update_to_read(u) for u in sorted(ticket.updates, key=lambda u: u.id or 0)]


def _payment_fields(session, ticket: Ticket) -> dict:
    """total/paid/balance for a ticket with a payment total (else all None)."""
    if ticket.total_amount is None:
        return {"total_amount": None, "paid_amount": None, "balance": None}
    paid = session.exec(
        select(func.coalesce(func.sum(Payment.amount), 0.0)).where(Payment.ticket_id == ticket.id)
    ).one()
    paid = float(paid or 0.0)
    return {
        "total_amount": ticket.total_amount,
        "paid_amount": paid,
        "balance": ticket.total_amount - paid,
    }


def _ticket_read(
    ticket: Ticket,
    customer_name: str | None = None,
    payment: dict | None = None,
    customer_city: str | None = None,
    mr_pending: bool = False,
    defective_pending: bool = False,
) -> TicketRead:
    """List-row view with the computed 72h assignment-SLA fields."""
    updates = ticket.updates
    payment = payment or {"total_amount": None, "paid_amount": None, "balance": None}
    return TicketRead(
        id=ticket.id,
        ticket_no=ticket.ticket_no,
        customer_id=ticket.customer_id,
        customer_name=customer_name,
        customer_city=customer_city,
        mr_pending=mr_pending,
        defective_pending=defective_pending,
        complaint_date=ticket.complaint_date,
        work_type=ticket.work_type,
        machine_type=ticket.machine_type,
        skill=ticket.skill,
        status=ticket.status,
        reopen=ticket.reopen,
        starred=ticket.starred,
        is_assigned=is_assigned(updates),
        assign_by=assign_by_date(ticket.complaint_date),
        assignment_overdue=assignment_overdue(ticket.complaint_date, updates),
        **payment,
    )


def _ticket_detail(session: SessionDep, ticket: Ticket) -> TicketDetail:
    customer = session.get(Customer, ticket.customer_id)
    updates = sorted(ticket.updates, key=lambda u: u.id or 0)
    edit_rows = session.exec(
        select(TicketEdit).where(TicketEdit.ticket_id == ticket.id).order_by(TicketEdit.id.desc())
    ).all()
    edits = []
    for e in edit_rows:
        eu = session.get(User, e.edited_by_user_id) if e.edited_by_user_id else None
        edits.append(TicketEditRead(
            id=e.id, note=e.note,
            edited_by_name=(eu.full_name or eu.username) if eu else None,
            edited_at=e.edited_at,
        ))
    return TicketDetail(
        id=ticket.id,
        ticket_no=ticket.ticket_no,
        customer_id=ticket.customer_id,
        complaint_date=ticket.complaint_date,
        work_type=ticket.work_type,
        machine_type=ticket.machine_type,
        skill=ticket.skill,
        status=ticket.status,
        reopen=ticket.reopen,
        starred=ticket.starred,
        is_assigned=is_assigned(updates),
        assign_by=assign_by_date(ticket.complaint_date),
        assignment_overdue=assignment_overdue(ticket.complaint_date, updates),
        customer_name=customer.name if customer else None,
        customer_city=customer.city if customer else None,
        mr_pending=ticket.id in mr_pending_ticket_ids(session),
        defective_pending=ticket.id in defective_pending_ticket_ids(session),
        primary_complaint=primary_complaint_of(updates),
        requires_tc=requires_tc(updates),
        cancel_reason=ticket.cancel_reason,
        bill_no=ticket.bill_no,
        bill_date=ticket.bill_date,
        bill_remarks=ticket.bill_remarks,
        is_commissioning=is_commissioning_ticket(session, updates),
        commissioning_status=ticket.commissioning_status,
        commissioning_remarks=ticket.commissioning_remarks,
        updates=[_update_to_read(u) for u in updates],
        edits=edits,
        **_payment_fields(session, ticket),
    )
