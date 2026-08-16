"""Notification response schemas."""

from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel


class NotificationRead(SQLModel):
    id: int
    kind: str
    title: str
    body: Optional[str] = None
    link: Optional[str] = None
    is_read: bool
    created_at: datetime


class NotificationList(SQLModel):
    unread: int
    items: list[NotificationRead] = []
