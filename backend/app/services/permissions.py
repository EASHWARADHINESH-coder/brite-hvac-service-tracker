"""Authorization helpers: who can see/act on which tickets.

Privileged roles (Service Admin / Engineer) act across all tickets. Task-scoped roles
(Task Manager / Helper) are limited to "their tasks": a ticket where the linked Team member is
the Job Lead OR appears in any lifecycle update's assigned team.
"""

from sqlmodel import Session, select

from app.core.enums import ORG_SCOPE_ROLES, PRIVILEGED_ROLES, UserRole
from app.models.masters import TeamMember
from app.models.tickets import TicketTeamLink, TicketUpdate
from app.models.user import User


def is_privileged(user: User) -> bool:
    """Can ACT across all tickets (Service Admin / Engineer). Gates writes — excludes MD."""
    return user.role in PRIVILEGED_ROLES


def has_org_scope(user: User) -> bool:
    """Can SEE every ticket (Admin / Engineer / Managing Director). Read scope only."""
    return user.role in ORG_SCOPE_ROLES


def is_read_only(user: User) -> bool:
    """Org-wide observer with no write rights (Managing Director)."""
    return user.role == UserRole.MANAGING_DIRECTOR


def owned_ticket_ids(session: Session, user: User) -> set[int]:
    """Ticket IDs assigned to this user's linked team member (job lead or team)."""
    if user.team_member_id is None:
        return set()
    member = session.get(TeamMember, user.team_member_id)
    if member is None:
        return set()

    # In the team of any lifecycle update.
    team_rows = session.exec(
        select(TicketUpdate.ticket_id)
        .join(TicketTeamLink, TicketTeamLink.ticket_update_id == TicketUpdate.id)
        .where(TicketTeamLink.team_member_id == user.team_member_id)
    ).all()

    # Job Lead (stored as a name string) matching the member's name.
    lead_rows = session.exec(
        select(TicketUpdate.ticket_id).where(TicketUpdate.job_lead == member.name)
    ).all()

    return set(team_rows) | set(lead_rows)


def can_view_ticket(session: Session, user: User, ticket_id: int) -> bool:
    # Read gate: org-scope roles (incl. MD) see everything; others only their own work.
    return has_org_scope(user) or ticket_id in owned_ticket_ids(session, user)
