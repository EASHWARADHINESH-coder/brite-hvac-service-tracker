#!/usr/bin/env python3
"""Copy customers + tickets (with lifecycle) from the LOCAL app to a TARGET app via the REST API.

Reads from the local running backend (values already serialized) and recreates the records on the
target (e.g. the live site). Idempotent: existing customers (by name) and tickets (by
customer+date+work-type) are skipped, so it's safe to re-run.

What it copies: customers, and tickets with their lifecycle updates + resulting status.
What it does NOT copy (API can't): users, the AI/RAG index, materials ledger/claims/payments.
For a byte-exact replica (including those), use the DB file swap in LOAD_DATA_TO_PROD.md instead.

Usage (dry run — reads local only, writes nothing, needs no target creds):
    python load_to_live.py --dry-run

Usage (live push):
    # bash
    LIVE_ADMIN_PASS='the-live-admin-password' python load_to_live.py \
        --target https://briteai.in/service/api/v1 --target-user admin
    # PowerShell
    $env:LIVE_ADMIN_PASS="the-live-admin-password"; python load_to_live.py `
        --target https://briteai.in/service/api/v1 --target-user admin
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

CUSTOMER_FIELDS = ("name", "address", "city", "pincode", "contact_person",
                   "contact_number", "secondary_mobile", "mail_id", "is_amc",
                   "warranty_start_date", "warranty_end_date")
UPDATE_FIELDS = ("stage", "action_date", "job_lead", "complaints", "materials",
                 "start_date", "end_date", "remarks", "reopen", "reopen_reason")


def _req(method, url, token=None, body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _login(base, user, password):
    return _req("POST", f"{base}/auth/login", body={"username": user, "password": password})["access_token"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="http://127.0.0.1:8000/api/v1")
    ap.add_argument("--source-user", default="admin")
    ap.add_argument("--source-pass", default=os.environ.get("LOCAL_ADMIN_PASS", "admin123"))
    ap.add_argument("--target", default="https://briteai.in/service/api/v1")
    ap.add_argument("--target-user", default=os.environ.get("LIVE_ADMIN_USER", "admin"))
    ap.add_argument("--target-pass", default=os.environ.get("LIVE_ADMIN_PASS"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    src, tgt = args.source.rstrip("/"), args.target.rstrip("/")

    # ---- read source ----
    print(f"Reading from source: {src}")
    stoken = _login(src, args.source_user, args.source_pass)
    customers = _req("GET", f"{src}/customers", token=stoken)
    ticket_list = _req("GET", f"{src}/tickets", token=stoken)
    details = [_req("GET", f"{src}/tickets/{t['id']}", token=stoken) for t in ticket_list]
    replays = sum(1 for d in details for u in d["updates"] if u["stage"] != "Logged")
    print(f"  source has {len(customers)} customers, {len(details)} tickets "
          f"({replays} lifecycle updates to replay)")

    if args.dry_run:
        print("\nDRY RUN - nothing written. Sample of what would be created:")
        for c in customers[:3]:
            print(f"  customer: {c['name']} ({c.get('city') or '-'})")
        for d in details[:3]:
            print(f"  ticket:   {d['ticket_no']} {d['work_type']} / {d.get('machine_type') or '-'} "
                  f"-> {d['status']} (+{len([u for u in d['updates'] if u['stage']!='Logged'])} updates)")
        return

    if not args.target_pass:
        sys.exit("Provide the target admin password via LIVE_ADMIN_PASS env var or --target-pass.")

    # ---- write target ----
    print(f"\nWriting to target: {tgt}")
    ttoken = _login(tgt, args.target_user, args.target_pass)

    # customers (skip existing by name; build name -> target id)
    existing = {c["name"].strip().lower(): c["id"] for c in _req("GET", f"{tgt}/customers", token=ttoken)}
    id_by_name = dict(existing)
    made_c = 0
    for c in customers:
        key = c["name"].strip().lower()
        if key in id_by_name:
            continue
        payload = {f: c.get(f) for f in CUSTOMER_FIELDS if c.get(f) is not None}
        new = _req("POST", f"{tgt}/customers", token=ttoken, body=payload)
        id_by_name[key] = new["id"]
        made_c += 1
    print(f"  customers: created {made_c}, already present {len(existing)}")

    # tickets (skip if same customer+date+work-type already there)
    tkey = lambda cn, cd, wt: f"{(cn or '').strip().lower()}|{cd}|{wt}"
    have = {tkey(t.get("customer_name"), t["complaint_date"], t["work_type"])
            for t in _req("GET", f"{tgt}/tickets", token=ttoken)}
    made_t = made_u = skipped = 0
    for d in sorted(details, key=lambda d: (d["complaint_date"], d["ticket_no"])):
        cid = id_by_name.get((d.get("customer_name") or "").strip().lower())
        if cid is None or tkey(d.get("customer_name"), d["complaint_date"], d["work_type"]) in have:
            skipped += 1
            continue
        logged = next((u for u in d["updates"] if u["stage"] == "Logged"), {})
        payload = {
            "customer_id": cid,
            "complaint_date": d["complaint_date"],
            "work_type": d["work_type"],
            "machine_type": d.get("machine_type"),
            "primary_complaint": d.get("primary_complaint"),
            "remarks": logged.get("remarks"),
        }
        if d.get("total_amount") is not None:
            payload["total_amount"] = d["total_amount"]
        new = _req("POST", f"{tgt}/tickets", token=ttoken, body=payload)
        made_t += 1
        for u in d["updates"]:
            if u["stage"] == "Logged":
                continue
            body = {f: u.get(f) for f in UPDATE_FIELDS if u.get(f) is not None}
            _req("POST", f"{tgt}/tickets/{new['id']}/updates", token=ttoken, body=body)
            made_u += 1
    print(f"  tickets: created {made_t} (+{made_u} lifecycle updates), skipped {skipped}")
    print("\nDONE. Run verify_prod.py to confirm counts, then change the admin password.")


if __name__ == "__main__":
    main()
