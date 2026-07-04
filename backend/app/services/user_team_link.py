"""Keep the User <-> Team link in sync.

Users and Team people are the same person, matched by name. Rather than relying
on a stored link that can drift when either side is renamed, we re-resolve every
user's team_member_id from its full name. Cheap (small tables) and self-healing.
"""

from sqlmodel import Session, select

from app.models.masters import TeamMember
from app.models.user import User


def resync_user_team_links(session: Session) -> None:
    """Re-point each user's team_member_id at the Team member whose name matches
    the user's full name (or None if there's no match). Commits only on change."""
    team_by_name = {m.name: m.id for m in session.exec(select(TeamMember)).all()}
    changed = False
    for u in session.exec(select(User)).all():
        matched = team_by_name.get(u.full_name) if u.full_name else None
        if matched != u.team_member_id:
            u.team_member_id = matched
            session.add(u)
            changed = True
    if changed:
        session.commit()
