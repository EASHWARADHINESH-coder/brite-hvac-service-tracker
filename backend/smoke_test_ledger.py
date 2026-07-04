"""Ad-hoc smoke test (SQLite) for the Phase 3 materials ledger."""

import os
import tempfile

db_path = os.path.join(tempfile.gettempdir(), "service_tracker_ledger.db")
if os.path.exists(db_path):
    os.remove(db_path)
os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
os.environ["ENV"] = "test"
os.environ["SEED_DEMO_DATA"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

with TestClient(app) as c:
    cust = c.post("/api/v1/customers", json={"name": "Test Co"}).json()
    ticket = c.post("/api/v1/tickets", json={
        "customer_id": cust["id"], "complaint_date": "2026-06-23",
        "work_type": "Breakdown", "machine_type": "VRF",
    }).json()

    # Inward: 45 kg R410A from a supplier
    inw = c.post("/api/v1/materials-ledger/inward", json={
        "source_type": "Supplier", "material_name": "R410A Gas", "uom": "kg",
        "qty": 45, "received_date": "2026-06-23", "supplier": "CoolGas Ltd",
    }).json()
    assert inw["inward_no"] == "IN2026062301", inw["inward_no"]

    # Stock: 45 received, 0 consumed, 45 available
    stock = {s["material_name"]: s for s in c.get("/api/v1/materials-ledger/stock").json()}
    assert stock["R410A Gas"]["available"] == 45, stock["R410A Gas"]

    # Allocate 40 kg to the ticket
    iss = c.post("/api/v1/materials-ledger/issues", json={
        "ticket_id": ticket["id"], "inward_id": inw["id"],
        "material_name": "R410A Gas", "uom": "kg", "qty": 40, "issue_date": "2026-06-23",
    }).json()
    assert iss["issue_no"] == "ISS2026062301", iss["issue_no"]
    assert iss["status"] == "Allocated"

    # Pending allocation shows, available still 45 (not consumed yet)
    stock = {s["material_name"]: s for s in c.get("/api/v1/materials-ledger/stock").json()}
    assert stock["R410A Gas"]["allocated_pending"] == 40
    assert stock["R410A Gas"]["available"] == 45

    # Deliver as Used -> delivery note + consumed
    delivered = c.post(f"/api/v1/materials-ledger/issues/{iss['id']}/deliver",
                       json={"outcome": "Used"}).json()
    assert delivered["delivery_note_no"] == "DN2026062301", delivered["delivery_note_no"]
    assert delivered["status"] == "Closed"

    stock = {s["material_name"]: s for s in c.get("/api/v1/materials-ledger/stock").json()}
    assert stock["R410A Gas"]["consumed"] == 40
    assert stock["R410A Gas"]["available"] == 5, stock["R410A Gas"]
    assert stock["R410A Gas"]["allocated_pending"] == 0

    # A Not-Used allocation does not consume
    iss2 = c.post("/api/v1/materials-ledger/issues", json={
        "ticket_id": ticket["id"], "material_name": "R410A Gas", "uom": "kg",
        "qty": 5, "issue_date": "2026-06-23",
    }).json()
    assert iss2["issue_no"] == "ISS2026062302"
    c.post(f"/api/v1/materials-ledger/issues/{iss2['id']}/deliver", json={"outcome": "Not Used"})
    stock = {s["material_name"]: s for s in c.get("/api/v1/materials-ledger/stock").json()}
    assert stock["R410A Gas"]["available"] == 5  # unchanged
    assert stock["R410A Gas"]["consumed"] == 40

    # Issues filtered by ticket
    issues = c.get("/api/v1/materials-ledger/issues", params={"ticket_id": ticket["id"]}).json()
    assert len(issues) == 2

print("LEDGER SMOKE TESTS PASSED")
