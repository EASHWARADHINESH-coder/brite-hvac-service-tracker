#!/usr/bin/env python3
"""Verify the production deployment after the database swap.

Hits the LIVE API end-to-end (nginx -> FastAPI -> SQLite) and checks that record counts match
the local snapshot that was loaded. Standard library only — runs with any Python 3, anywhere.

Usage (PowerShell):
    $env:ADMIN_PASS="the-admin-password"; python verify_prod.py
Usage (bash):
    ADMIN_PASS='the-admin-password' python verify_prod.py
Options:
    python verify_prod.py --base https://briteai.in/service/api/v1 --user admin --pass ...

Exit code 0 = all checks passed, 1 = something is short (re-check the swap).
Note: EXPECTED reflects the snapshot loaded on 2026-07 (179 customers / 48 tickets / 227 RAG
docs). If you refresh prod with newer local data, update these numbers.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_BASE = "https://briteai.in/service/api/v1"
EXPECTED = {
    "customers": 179,
    "tickets": 48,
    "breakdown_tickets": 24,
    "pms_tickets": 23,
    "rag_documents": 227,
}


def _req(method, url, token=None, body=None, timeout=25):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("BASE_URL", DEFAULT_BASE))
    ap.add_argument("--user", default=os.environ.get("ADMIN_USER", "admin"))
    ap.add_argument("--pass", dest="password", default=os.environ.get("ADMIN_PASS"))
    args = ap.parse_args()
    base = args.base.rstrip("/")
    if not args.password:
        sys.exit("Provide the admin password via ADMIN_PASS env var or --pass.")

    print(f"Target: {base}\n")

    # 1) health (no auth)
    try:
        print("health:", _req("GET", f"{base}/health"))
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"FAIL: health check errored at {base}/health -> {exc}")

    # 2) login
    try:
        tok = _req("POST", f"{base}/auth/login",
                   body={"username": args.user, "password": args.password})["access_token"]
        print("login: OK\n")
    except urllib.error.HTTPError as exc:
        sys.exit(f"FAIL: login ({exc.code}). Check credentials, and that the swap kept the admin user.")

    results: list[bool] = []

    def check(name, actual, expected):
        ok = isinstance(actual, int) and actual >= expected
        results.append(ok)
        print(f"  [{'OK' if ok else '!!'}] {name:18} actual={actual}  expected>={expected}")

    check("customers", len(_req("GET", f"{base}/customers", token=tok)), EXPECTED["customers"])
    check("tickets", len(_req("GET", f"{base}/tickets", token=tok)), EXPECTED["tickets"])
    check("breakdown_tickets",
          len(_req("GET", f"{base}/tickets?work_type=Breakdown", token=tok)), EXPECTED["breakdown_tickets"])
    check("pms_tickets",
          len(_req("GET", f"{base}/tickets?work_type=PMS", token=tok)), EXPECTED["pms_tickets"])

    try:
        summ = _req("GET", f"{base}/dashboard/summary", token=tok)
        check("dashboard_total", summ.get("total_tickets"), EXPECTED["tickets"])
    except Exception as exc:  # noqa: BLE001
        print(f"  [ -] dashboard_total    skipped ({exc})")

    # AI / RAG index (optional — only if AI is enabled on the server)
    try:
        health = _req("GET", f"{base}/ai/health", token=tok)
        if health.get("enabled"):
            check("rag_documents", health.get("indexed_documents"), EXPECTED["rag_documents"])
        else:
            print("  [ -] rag_documents      skipped (AI disabled on server)")
    except Exception as exc:  # noqa: BLE001
        print(f"  [ -] rag_documents      skipped (/ai/health unavailable: {exc})")

    print()
    if all(results):
        print("RESULT: PASS - production matches the loaded snapshot.")
    else:
        print("RESULT: FAIL - one or more counts are short. Re-check the DB swap steps.")
        sys.exit(1)


if __name__ == "__main__":
    main()
