"""Ad-hoc smoke test (SQLite) for the Phase 1 API. Not part of the test suite."""

import os
import tempfile

db_path = os.path.join(tempfile.gettempdir(), "service_tracker_smoke.db")
if os.path.exists(db_path):
    os.remove(db_path)
os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
os.environ["ENV"] = "test"
os.environ["SEED_DEMO_DATA"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from smoke_auth_helper import authenticate  # noqa: E402

with TestClient(app) as c:
    authenticate(c)
    assert c.get("/api/v1/health").json() == {"status": "ok"}

    # seeded masters
    assert len(c.get("/api/v1/skills").json()) == 30
    assert len(c.get("/api/v1/complaints").json()) == 18
    assert len(c.get("/api/v1/materials").json()) == 7

    # customer
    cust = c.post("/api/v1/customers", json={"name": "Theni Anantham Silks", "city": "Madurai"}).json()

    # ticket — number + skill derivation
    t1 = c.post("/api/v1/tickets", json={
        "customer_id": cust["id"], "complaint_date": "2026-06-13",
        "work_type": "Breakdown", "machine_type": "VRF",
        "primary_complaint": "Compressor failure", "remarks": "Compressor failure",
    }).json()
    assert t1["ticket_no"] == "B2026061301", t1["ticket_no"]
    assert t1["skill"] == "Major Breakdown - VRF", t1["skill"]
    assert t1["status"] == "Open"
    assert len(t1["updates"]) == 1 and t1["updates"][0]["stage"] == "Logged"

    # second ticket same day, different work type -> continuous running number
    t2 = c.post("/api/v1/tickets", json={
        "customer_id": cust["id"], "complaint_date": "2026-06-13",
        "work_type": "PMS", "machine_type": "Ductable",
    }).json()
    assert t2["ticket_no"] == "P2026061302", t2["ticket_no"]

    # team member + lifecycle update -> In Progress
    tm = c.post("/api/v1/team", json={"name": "Kathar Batcha", "team_type": "Technician"}).json()
    d = c.post(f"/api/v1/tickets/{t1['id']}/updates", json={
        "stage": "Repair In Progress", "action_date": "2026-06-14",
        "job_lead": "Vinoth Kanna", "team_ids": [tm["id"]],
        "complaints": "Compressor failure", "start_date": "2026-06-13",
    }).json()
    assert d["status"] == "In Progress", d["status"]
    assert d["updates"][-1]["team"][0]["name"] == "Kathar Batcha"

    # closing update -> Closed
    closed = c.post(f"/api/v1/tickets/{t1['id']}/updates", json={
        "stage": "Closed", "action_date": "2026-06-19", "end_date": "2026-06-19",
        "remarks": "Commissioned",
    }).json()
    assert closed["status"] == "Closed", closed["status"]

    # reopen -> same ticket number, Reopened status
    reopened = c.post(f"/api/v1/tickets/{t1['id']}/updates", json={
        "stage": "Reopened", "reopen": True, "reopen_reason": "Again Gas Leakage",
    }).json()
    assert reopened["ticket_no"] == "B2026061301"
    assert reopened["status"] == "Reopened", reopened["status"]
    assert reopened["reopen"] is True

    # PMS auto-generated visit dates (every 2 months from start)
    pms = c.post("/api/v1/pms", json={
        "customer_id": cust["id"], "wo_number": "WO-001",
        "wo_start_date": "2026-01-15", "schedule": "2 Months Once/Year",
    }).json()
    # Visit dates are normalised to the 1st of the month (see services/pms_schedule).
    assert pms["schedule_1"] == "2026-01-01", pms["schedule_1"]
    assert pms["schedule_2"] == "2026-03-01", pms["schedule_2"]
    assert pms["schedule_6"] == "2026-11-01", pms["schedule_6"]

    # materials tracker snapshots ticket context
    mt = c.post("/api/v1/materials-tracker", json={
        "ticket_id": t1["id"], "material_name": "R410A Gas", "uom": "kg",
        "requested_qty": 45, "received_qty": 40,
    }).json()
    assert mt["work_type"] == "Breakdown" and mt["machine_type"] == "VRF"

    # dashboard
    s = c.get("/api/v1/dashboard/summary").json()
    assert s["total_tickets"] == 2
    assert s["reopened"] == 1, s

print("ALL SMOKE TESTS PASSED")
