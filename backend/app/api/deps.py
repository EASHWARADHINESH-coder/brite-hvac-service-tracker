"""Shared FastAPI dependencies: DB session and authentication/authorization."""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session, select

from app.core.enums import UserRole
from app.core.security import decode_access_token
from app.database import get_session
from app.models.user import User

SessionDep = Annotated[Session, Depends(get_session)]

_bearer = HTTPBearer(auto_error=True)


def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials, Depends(_bearer)],
    session: SessionDep,
) -> User:
    payload = decode_access_token(creds.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = session.exec(select(User).where(User.username == payload["sub"])).first()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: UserRole):
    """Dependency factory: allow only the given roles."""

    def _checker(user: CurrentUser) -> User:
        if user.role not in roles:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Requires one of: {', '.join(r.value for r in roles)}",
            )
        return user

    return _checker


# Common guards.
require_admin = require_roles(UserRole.SERVICE_ADMIN)
require_engineer = require_roles(UserRole.SERVICE_ADMIN, UserRole.SERVICE_ENGINEER)
AdminDep = Annotated[User, Depends(require_admin)]
EngineerDep = Annotated[User, Depends(require_engineer)]
