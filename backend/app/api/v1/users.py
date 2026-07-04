"""User management — Service Admin only."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select

from app.api.deps import SessionDep, require_admin
from app.core.security import hash_password
from app.models.masters import TeamMember
from app.models.user import User
from app.schemas.auth import UserCreate, UserRead, UserUpdate
from app.services.user_team_link import resync_user_team_links

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(require_admin)])


def _match_team_member_id(session: SessionDep, full_name: str | None) -> int | None:
    """Users and Team people are the same: link by matching full name to a Team member."""
    if not full_name:
        return None
    member = session.exec(
        select(TeamMember).where(TeamMember.name == full_name)
    ).first()
    return member.id if member else None


@router.get("", response_model=list[UserRead])
def list_users(session: SessionDep):
    # Self-heal the user<->team link by name before listing, so the Name link
    # stays correct even after a rename on either side.
    resync_user_team_links(session)
    return session.exec(select(User).order_by(User.username)).all()


@router.post("", response_model=UserRead, status_code=201)
def create_user(payload: UserCreate, session: SessionDep):
    if session.exec(select(User).where(User.username == payload.username)).first():
        raise HTTPException(409, "Username already exists")
    user = User(
        username=payload.username,
        email=payload.email,
        full_name=payload.full_name,
        role=payload.role,
        team_member_id=_match_team_member_id(session, payload.full_name),
        hashed_password=hash_password(payload.password),
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserRead)
def update_user(user_id: int, payload: UserUpdate, session: SessionDep):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    data = payload.model_dump(exclude_unset=True)

    # Username is editable; enforce uniqueness.
    new_username = data.get("username")
    if new_username and new_username != user.username:
        clash = session.exec(
            select(User).where(User.username == new_username, User.id != user_id)
        ).first()
        if clash:
            raise HTTPException(409, "Username already exists")

    if "password" in data:
        user.hashed_password = hash_password(data.pop("password"))
    for key, value in data.items():
        setattr(user, key, value)

    # Re-resolve the team link from the (possibly updated) full name.
    user.team_member_id = _match_team_member_id(session, user.full_name)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@router.post("/{user_id}/deactivate", response_model=UserRead)
def deactivate_user(user_id: int, session: SessionDep):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.is_active = False
    session.add(user)
    session.commit()
    session.refresh(user)
    return user
