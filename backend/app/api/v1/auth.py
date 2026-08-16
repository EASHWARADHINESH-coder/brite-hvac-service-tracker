from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.core.enums import UserRole
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.schemas.auth import ChangePasswordRequest, LoginRequest, Token, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=Token)
def login(payload: LoginRequest, session: SessionDep):
    user = session.exec(select(User).where(User.username == payload.username)).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect username or password")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is inactive")

    token = create_access_token(subject=user.username, role=user.role.value)
    return Token(
        access_token=token,
        role=user.role,
        full_name=user.full_name,
        username=user.username,
    )


@router.get("/me", response_model=UserRead)
def me(user: CurrentUser):
    return user


# Minimum length for a self-set password.
_MIN_PASSWORD_LEN = 8


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
def change_own_password(
    payload: ChangePasswordRequest, session: SessionDep, user: CurrentUser
) -> None:
    """Let a user change their own password.

    Scoped to Managing Director only (locked decision): every other role's password is
    managed by a Service Admin through /users. Requires the current password, so a stolen
    session alone cannot lock the owner out.
    """
    if user.role != UserRole.MANAGING_DIRECTOR:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Self-service password change is available to the Managing Director only",
        )
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if len(payload.new_password) < _MIN_PASSWORD_LEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"New password must be at least {_MIN_PASSWORD_LEN} characters",
        )
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "New password must differ from the current one"
        )
    if payload.new_password == user.username:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Password must not be the same as the username"
        )

    user.hashed_password = hash_password(payload.new_password)
    session.add(user)
    session.commit()
