"""Ad-hoc smoke test (SQLite) for Phase 4 auth + roles."""

import os
import tempfile

db_path = os.path.join(tempfile.gettempdir(), "service_tracker_auth.db")
if os.path.exists(db_path):
    os.remove(db_path)
os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
os.environ["ENV"] = "test"
os.environ["SEED_DEMO_DATA"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.core.enums import UserRole  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.database import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.masters import TeamMember  # noqa: E402
from app.models.user import User  # noqa: E402
from sqlmodel import Session  # noqa: E402


def auth(token):
    return {"Authorization": f"Bearer {token}"}


with TestClient(app) as c:
    # No token -> 401/403 on protected route
    assert c.get("/api/v1/tickets").status_code in (401, 403)

    # Seed an admin + a task-manager user linked to a team member
    with Session(engine) as s:
        tm = TeamMember(name="Kathar Batcha", team_type="Technician")
        s.add(tm)
        s.commit()
        s.refresh(tm)
        s.add(User(username="admin", role=UserRole.SERVICE_ADMIN,
                   hashed_password=hash_password("admin123")))
        s.add(User(username="kathar", role=UserRole.TECHNICIAN, team_member_id=tm.id,
                   hashed_password=hash_password("pass123")))
        s.add(User(username="helper", role=UserRole.HELPER, team_member_id=tm.id,
                   hashed_password=hash_password("pass123")))
        s.commit()
        tm_id = tm.id

    # Login
    admin_t = c.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"}).json()["access_token"]
    kathar_t = c.post("/api/v1/auth/login", json={"username": "kathar", "password": "pass123"}).json()["access_token"]
    helper_t = c.post("/api/v1/auth/login", json={"username": "helper", "password": "pass123"}).json()["access_token"]

    # Wrong password rejected
    assert c.post("/api/v1/auth/login", json={"username": "admin", "password": "x"}).status_code == 401

    # /me
    assert c.get("/api/v1/auth/me", headers=auth(kathar_t)).json()["role"] == "Technician"

    # Admin can create master data; task manager cannot
    cust = c.post("/api/v1/customers", json={"name": "Acme"}, headers=auth(admin_t))
    assert cust.status_code == 201, cust.text
    cust_id = cust.json()["id"]
    assert c.post("/api/v1/customers", json={"name": "Nope"}, headers=auth(kathar_t)).status_code == 403

    # Admin creates a ticket; engineer-level action
    t = c.post("/api/v1/tickets", json={
        "customer_id": cust_id, "complaint_date": "2026-06-23",
        "work_type": "Breakdown", "machine_type": "VRF",
    }, headers=auth(admin_t)).json()
    tid = t["id"]

    # Task manager cannot create tickets
    assert c.post("/api/v1/tickets", json={
        "customer_id": cust_id, "complaint_date": "2026-06-23",
        "work_type": "Breakdown", "machine_type": "VRF",
    }, headers=auth(kathar_t)).status_code == 403

    # Ticket not yet assigned -> task manager sees none, cannot view
    assert c.get("/api/v1/tickets", headers=auth(kathar_t)).json() == []
    assert c.get(f"/api/v1/tickets/{tid}", headers=auth(kathar_t)).status_code == 403

    # Assign kathar via a lifecycle update (admin adds him to the team)
    c.post(f"/api/v1/tickets/{tid}/updates", json={
        "stage": "Assigned", "team_ids": [tm_id], "action_date": "2026-06-23",
    }, headers=auth(admin_t))

    # Now it's "their task": kathar sees it and can update it
    assert len(c.get("/api/v1/tickets", headers=auth(kathar_t)).json()) == 1
    upd = c.post(f"/api/v1/tickets/{tid}/updates", json={
        "stage": "Repair In Progress", "remarks": "working on it",
    }, headers=auth(kathar_t))
    assert upd.status_code == 201, upd.text

    # Helper can view their task but NOT update it
    assert c.get(f"/api/v1/tickets/{tid}", headers=auth(helper_t)).status_code == 200
    assert c.post(f"/api/v1/tickets/{tid}/updates", json={"stage": "Closed"},
                  headers=auth(helper_t)).status_code == 403

    # Task manager can record material usage on their task; helper cannot
    assert c.post("/api/v1/materials-tracker", json={
        "ticket_id": tid, "material_name": "R410A Gas", "uom": "kg", "requested_qty": 5,
    }, headers=auth(kathar_t)).status_code == 201
    assert c.post("/api/v1/materials-tracker", json={
        "ticket_id": tid, "material_name": "R410A Gas", "uom": "kg", "requested_qty": 5,
    }, headers=auth(helper_t)).status_code == 403

    # Users management is admin-only
    assert c.get("/api/v1/users", headers=auth(admin_t)).status_code == 200
    assert c.get("/api/v1/users", headers=auth(kathar_t)).status_code == 403

print("AUTH SMOKE TESTS PASSED")
