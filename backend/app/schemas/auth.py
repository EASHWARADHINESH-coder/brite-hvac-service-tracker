"""Auth and user-management schemas."""

from typing import Optional

from sqlmodel import SQLModel

from app.core.enums import UserRole


class LoginRequest(SQLModel):
    username: str
    password: str


class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"
    role: UserRole
    full_name: Optional[str] = None
    username: str


class UserCreate(SQLModel):
    username: str
    password: str
    role: UserRole
    full_name: Optional[str] = None
    email: Optional[str] = None
    team_member_id: Optional[int] = None


class ChangePasswordRequest(SQLModel):
    current_password: str
    new_password: str


class UserUpdate(SQLModel):
    username: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class UserRead(SQLModel):
    id: int
    username: str
    email: Optional[str]
    full_name: Optional[str]
    role: UserRole
    is_active: bool
    team_member_id: Optional[int]
