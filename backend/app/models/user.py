"""Application login users (distinct from the Team master).

A user may be linked to a Team member (team_member_id) so task-scoped roles
(Task Manager / Helper) resolve "their tasks" by that member's assignments.
"""

from typing import Optional

from sqlmodel import Field, SQLModel

from app.core.enums import UserRole


class User(SQLModel, table=True):
    __tablename__ = "app_user"

    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    email: Optional[str] = None
    full_name: Optional[str] = None
    hashed_password: str
    role: UserRole
    is_active: bool = Field(default=True)

    # Link to a Team master row (required for Task Manager / Helper task scoping).
    team_member_id: Optional[int] = Field(default=None, foreign_key="team_member.id")
