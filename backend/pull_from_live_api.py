#!/usr/bin/env python3
"""Pull customers + tickets (with lifecycle) from the LIVE site's API into the local dev.db.

A BACKUP to the DB file swap (pull_from_live.py / PULL_FROM_LIVE.md). Use this only when you
can't SFTP the database file down - it needs no server access, just the live admin login.

  * PARTIAL by design. The read API exposes customers and tickets(+lifecycle) only, so this
    does NOT copy users, payments, material claims, the materials ledger, or the AI index.
    For a complete, byte-exact copy use the file swap.
  * Idempotent. Customers already present locally (by name) and tickets already present (by
    ticket number) are skipped, so it's safe to re-run.
  * Writes straight into local dev.db via the ORM, preserving ticket numbers exactly.

Usage (from backend/, venv active):
    # PowerShell
    $env:LIVE_ADMIN_PASS="the-live-admin-password"
    python pull_from_live_api.py --source https://briteai.in/service/api/v1 --source-user admin
    # bash
    LIVE_ADMIN_PASS='the-live-admin-password' python pull_from_live_api.py \
        --source https://briteai.in/service/api/v1 --source-user admin

    python pull_from_live_api.py ... --dry-run     # read + report only, write nothing
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date

CUSTOMER_FIELDS = ("name", "address", "city", "pincode", "contact_person", "contact_number",
                   "secondary_mobile", "mail_id", "is_amc", "warranty_start_date",
                   "warranty_end_date")


def _req(method: str, url: str, token: str | None = None, body=None, timeout: int = 60):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        sys.exit(f"ERROR: {method} {url} -> {exc.code}\n  {detail}")
    except urllib.error.URLError as exc:
        sys.exit(f"ERROR: cannot reach {url}: {exc.reason}")


def _login(base: str, user: str, password: str) -> str:
    tok = _req("POST", f"{base}/auth/login", body={"username": user, "password": password})
    if not tok or "access_token" not in tok:
        sys.exit("ERROR: live login failed - check --source-user and LIVE_ADMIN_PASS.")
    return tok["access_token"]


def _date(s):
    return date.fromisoformat(s) if s else None


def main() -> None:
    ap = argparse.ArgumentParser(description="Pull live customers + tickets into local dev.db (partial).")
    ap.add_argument("--source", required=True, help="live API base, e.g. https://briteai.in/service/api/v1")
    ap.add_argument("--source-user", default="admin", help="live admin username (default: admin)")
    ap.add_argument("--dry-run", action="store_true", help="read + report only; write nothing")
    args = ap.parse_args()

    password = os.environ.get("LIVE_ADMIN_PASS")
    if not password:
        sys.exit("ERROR: set the live admin password in the LIVE_ADMIN_PASS environment variable.")

    base = args.source.rstrip("/")
    print(f"Source: {base}  (user: {args.source_user})")
    token = _login(base, args.source_user, password)

    # --- read from live ---
    customers = _req("GET", f"{base}/customers", token=token) or []
    ticket_list = _req("GET", f"{base}/tickets", token=token) or []
    print(f"Live has {len(customers)} customers and {len(ticket_list)} tickets. Fetching lifecycle...")
    details = []
    for i, t in enumerate(ticket_list, 1):
        details.append(_req("GET", f"{base}/tickets/{t['id']}", token=token))
        if i % 25 == 0:
            print(f"  ...{i}/{len(ticket_list)}")

    # --- write into local dev.db via the ORM ---
    # Imported here so a bad --source fails before the app/DB is touched.
    import logging
    logging.disable(logging.INFO)
    from sqlmodel import Session, select
    from app.database import engine
    engine.echo = False
    from app.models.masters import Customer, TeamMember
    from app.models.tickets import Ticket, TicketUpdate
    from app.core.enums import LifecycleStage, MachineType, TicketStatus, WorkType

    added_c = added_t = skipped_c = skipped_t = 0
    with Session(engine) as s:
        local_cust = {c.name.lower(): c for c in s.exec(select(Customer)).all()}
        local_team = {m.name.lower(): m for m in s.exec(select(TeamMember)).all()}
        local_tno = {t.ticket_no for t in s.exec(select(Ticket)).all()}

        # customers first (tickets reference them by name)
        for c in customers:
            if c["name"].lower() in local_cust:
                skipped_c += 1
                continue
            if not args.dry_run:
                row = Customer(**{k: c.get(k) for k in CUSTOMER_FIELDS})
                row.warranty_start_date = _date(c.get("warranty_start_date"))
                row.warranty_end_date = _date(c.get("warranty_end_date"))
                s.add(row)
                s.flush()
                local_cust[row.name.lower()] = row
            added_c += 1

        # tickets + their lifecycle
        for d in details:
            if d["ticket_no"] in local_tno:
                skipped_t += 1
                continue
            cust = local_cust.get((d.get("customer_name") or "").lower())
            if cust is None:
                print(f"  ! skip {d['ticket_no']} - customer '{d.get('customer_name')}' not found locally")
                skipped_t += 1
                continue
            if not args.dry_run:
                ticket = Ticket(
                    ticket_no=d["ticket_no"],
                    customer_id=cust.id,
                    complaint_date=_date(d["complaint_date"]),
                    work_type=WorkType(d["work_type"]),
                    machine_type=MachineType(d["machine_type"]) if d.get("machine_type") else None,
                    skill=d.get("skill"),
                    total_amount=d.get("total_amount"),
                    status=TicketStatus(d["status"]),
                    reopen=bool(d.get("reopen")),
                )
                s.add(ticket)
                s.flush()
                for u in d.get("updates", []):
                    upd = TicketUpdate(
                        ticket_id=ticket.id,
                        stage=LifecycleStage(u["stage"]),
                        action_date=_date(u.get("action_date")),
                        job_lead=u.get("job_lead"),
                        complaints=u.get("complaints"),
                        materials=u.get("materials"),
                        start_date=_date(u.get("start_date")),
                        end_date=_date(u.get("end_date")),
                        status=TicketStatus(u["status"]),
                        remarks=u.get("remarks"),
                        reopen=bool(u.get("reopen")),
                        reopen_reason=u.get("reopen_reason"),
                    )
                    # Re-link team members by name (any not present locally are just skipped).
                    upd.team = [
                        local_team[m["name"].lower()]
                        for m in u.get("team", []) if m["name"].lower() in local_team
                    ]
                    s.add(upd)
            added_t += 1

        if not args.dry_run:
            s.commit()

    verb = "would add" if args.dry_run else "added"
    print(f"\n{verb}: {added_c} customers, {added_t} tickets "
          f"(skipped {skipped_c} existing customers, {skipped_t} existing/unmapped tickets)")
    if args.dry_run:
        print("(dry run - nothing written)")
    else:
        print("Done. Restart the backend, then POST /api/v1/ai/reindex to refresh semantic search.")
        print("NOTE: users, payments, claims, materials ledger and the AI index were NOT copied "
              "(API can't). Use the file swap for a complete replica.")


if __name__ == "__main__":
    main()
