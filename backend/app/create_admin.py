"""Create the first Service Admin from the command line.

Usage:
    python -m app.create_admin <username> <password> [full_name]

Idempotent on username: refuses if the username already exists.
"""

import sys

from sqlmodel import Session, select

from app.core.enums import UserRole
from app.core.security import hash_password
from app.database import create_db_and_tables, engine
from app.models.user import User


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: python -m app.create_admin <username> <password> [full_name]")
        raise SystemExit(2)

    username, password = sys.argv[1], sys.argv[2]
    full_name = sys.argv[3] if len(sys.argv) > 3 else "Service Admin"

    create_db_and_tables()
    with Session(engine) as session:
        if session.exec(select(User).where(User.username == username)).first():
            print(f"User '{username}' already exists; nothing to do.")
            return
        session.add(
            User(
                username=username,
                full_name=full_name,
                role=UserRole.SERVICE_ADMIN,
                hashed_password=hash_password(password),
            )
        )
        session.commit()
        print(f"Created Service Admin '{username}'.")


if __name__ == "__main__":
    main()
