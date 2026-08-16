"""Shared bootstrap for the ad-hoc smoke tests.

Every API route is authenticated, so a smoke test has to create a user and present a bearer
token before it can touch anything. Import and call `authenticate(client)` right after the
TestClient is opened.
"""

from sqlmodel import Session, select

SMOKE_USER = "smoketest"
SMOKE_PASSWORD = "smoketest123"


def authenticate(client, role=None):
    """Create (once) a user with `role` and attach its token to `client` for all requests."""
    from app.core.enums import UserRole
    from app.core.security import hash_password
    from app.database import engine
    from app.models.user import User

    role = role or UserRole.SERVICE_ADMIN

    with Session(engine) as session:
        existing = session.exec(select(User).where(User.username == SMOKE_USER)).first()
        if not existing:
            session.add(
                User(
                    username=SMOKE_USER,
                    full_name="Smoke Test",
                    hashed_password=hash_password(SMOKE_PASSWORD),
                    role=role,
                    is_active=True,
                )
            )
            session.commit()

    res = client.post(
        "/api/v1/auth/login",
        json={"username": SMOKE_USER, "password": SMOKE_PASSWORD},
    )
    assert res.status_code == 200, f"smoke login failed: {res.status_code} {res.text}"
    token = res.json()["access_token"]
    client.headers.update({"Authorization": f"Bearer {token}"})
    return token
