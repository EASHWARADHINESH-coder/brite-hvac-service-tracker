from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import func, select

from app.api.deps import SessionDep, get_current_user, require_admin
from app.core.enums import TeamType, UserRole
from app.core.security import hash_password
from app.models.masters import TeamMember
from app.models.tickets import Ticket, TicketTeamLink, TicketUpdate
from app.models.user import User
from app.schemas.masters import (
    TeamMemberCreate,
    TeamMemberCreateWithAccess,
    TeamMemberRead,
)
from app.schemas.tickets import TicketRead
from app.services.user_team_link import resync_user_team_links

router = APIRouter(prefix="/team", tags=["team"], dependencies=[Depends(get_current_user)])

# Mobile-login role granted per person category. Contractors don't log in.
ACCESS_ROLE = {
    TeamType.TECHNICIAN: UserRole.TECHNICIAN,
    TeamType.HELPER: UserRole.HELPER,
}


def _member_ticket_ids(session: SessionDep, member: TeamMember) -> set[int]:
    """Tickets where this person is on a lifecycle update's team OR is the job lead."""
    team_rows = session.exec(
        select(TicketUpdate.ticket_id)
        .join(TicketTeamLink, TicketTeamLink.ticket_update_id == TicketUpdate.id)
        .where(TicketTeamLink.team_member_id == member.id)
    ).all()
    lead_rows = session.exec(
        select(TicketUpdate.ticket_id).where(TicketUpdate.job_lead == member.name)
    ).all()
    return set(team_rows) | set(lead_rows)


@router.get("", response_model=list[TeamMemberRead])
def list_team(session: SessionDep):
    return session.exec(select(TeamMember).order_by(TeamMember.name)).all()


@router.post("", response_model=TeamMemberRead, status_code=201, dependencies=[Depends(require_admin)])
def create_member(payload: TeamMemberCreateWithAccess, session: SessionDep):
    access = payload.model_dump(include={"grant_access", "username", "password"})
    member_data = payload.model_dump(exclude={"grant_access", "username", "password"})

    if access["grant_access"]:
        # Validate the login up-front so a failure doesn't leave an orphan member.
        if member_data["team_type"] not in ACCESS_ROLE:
            raise HTTPException(400, "Contractors don't get app access.")
        if not access["username"] or not access["password"]:
            raise HTTPException(400, "Username and password are required for mobile access.")
        if session.exec(select(User).where(User.username == access["username"])).first():
            raise HTTPException(409, "Username already exists.")

    member = TeamMember(**member_data)
    session.add(member)
    session.flush()  # assign member.id without ending the transaction

    if access["grant_access"]:
        session.add(
            User(
                username=access["username"],
                full_name=member.name,
                role=ACCESS_ROLE[member.team_type],
                hashed_password=hash_password(access["password"]),
                team_member_id=member.id,
                is_active=True,
            )
        )

    session.commit()
    session.refresh(member)
    # A new person may match an existing user by name — link them.
    resync_user_team_links(session)
    return member


@router.get("/{member_id}/tickets", response_model=list[TicketRead])
def member_tickets(member_id: int, session: SessionDep):
    member = session.get(TeamMember, member_id)
    if not member:
        raise HTTPException(404, "Team member not found")
    ids = _member_ticket_ids(session, member)
    if not ids:
        return []
    return session.exec(
        select(Ticket).where(Ticket.id.in_(ids)).order_by(Ticket.ticket_no.desc())
    ).all()


@router.get("/{member_id}", response_model=TeamMemberRead)
def get_member(member_id: int, session: SessionDep):
    member = session.get(TeamMember, member_id)
    if not member:
        raise HTTPException(404, "Team member not found")
    return member


@router.put("/{member_id}", response_model=TeamMemberRead, dependencies=[Depends(require_admin)])
def update_member(member_id: int, payload: TeamMemberCreate, session: SessionDep):
    member = session.get(TeamMember, member_id)
    if not member:
        raise HTTPException(404, "Team member not found")
    for key, value in payload.model_dump().items():
        setattr(member, key, value)
    session.add(member)
    session.commit()
    session.refresh(member)
    # A rename can change which user matches this person — resync links.
    resync_user_team_links(session)
    return member


@router.delete("/{member_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_member(member_id: int, session: SessionDep):
    member = session.get(TeamMember, member_id)
    if not member:
        raise HTTPException(404, "Team member not found")

    # Block deletion while this person is referenced elsewhere.
    user_count = session.exec(
        select(func.count()).select_from(User).where(User.team_member_id == member_id)
    ).one()
    team_count = session.exec(
        select(func.count())
        .select_from(TicketTeamLink)
        .where(TicketTeamLink.team_member_id == member_id)
    ).one()
    lead_count = session.exec(
        select(func.count())
        .select_from(TicketUpdate)
        .where(TicketUpdate.job_lead == member.name)
    ).one()
    if user_count or team_count or lead_count:
        parts = []
        if user_count:
            parts.append(f"{user_count} login user(s)")
        if lead_count:
            parts.append(f"job lead on {lead_count} update(s)")
        if team_count:
            parts.append(f"team on {team_count} ticket update(s)")
        raise HTTPException(
            409,
            f"Cannot delete '{member.name}' — linked to {', '.join(parts)}.",
        )

    session.delete(member)
    session.commit()
