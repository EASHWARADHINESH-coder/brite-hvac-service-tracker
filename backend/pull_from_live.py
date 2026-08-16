#!/usr/bin/env python3
"""Swap a downloaded live-site database snapshot in as the local dev database.

Companion to LOAD_DATA_TO_PROD.md, but in the opposite direction: after you've pulled the
production SQLite file down from the VPS (see the chat steps / README), this backs up the
current dev.db, swaps the snapshot in, clears stale WAL sidecars, and verifies the result.

The whole app is SQLite, so a file swap replicates everything exactly: customers, tickets,
lifecycle history, users (with password hashes), materials ledger, claims, payments and the
AI/RAG index.

Usage (from the backend/ folder, with the venv active):
    python pull_from_live.py                      # swap in ./live-snapshot.db
    python pull_from_live.py other-snapshot.db    # swap in a differently-named file
    python pull_from_live.py --dry-run            # inspect the snapshot, change nothing
    python pull_from_live.py --restore            # roll dev.db back to the newest backup

Safety:
  * dev.db is always backed up to dev-backup-<timestamp>.db before being replaced.
  * The snapshot is validated (real SQLite + expected tables) before anything is touched.
  * A snapshot with no customers AND no tickets is refused unless you pass --force.
"""

from __future__ import annotations

import argparse
import glob
import os
import shutil
import sqlite3
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DEV_DB = os.path.join(HERE, "dev.db")
SIDECARS = (DEV_DB + "-wal", DEV_DB + "-shm")

# Tables that must exist for this to be a real Service Tracker database.
REQUIRED_TABLES = {"ticket", "customer", "app_user"}


def _counts(db_path: str) -> dict:
    """Row counts + usernames from a SQLite file, without touching the app/ORM."""
    con = sqlite3.connect(db_path)
    try:
        tables = {r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
        missing = REQUIRED_TABLES - tables
        if missing:
            raise ValueError(f"not a Service Tracker DB - missing tables: {', '.join(sorted(missing))}")

        def n(t: str) -> int:
            return con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]

        users = [r[0] for r in con.execute("SELECT username FROM app_user ORDER BY username")]
        return {
            "customers": n("customer"),
            "tickets": n("ticket"),
            "ticket_updates": n("ticket_update") if "ticket_update" in tables else 0,
            "users": len(users),
            "usernames": users,
        }
    finally:
        con.close()


def _validate_snapshot(path: str) -> dict:
    if not os.path.exists(path):
        sys.exit(f"ERROR: Snapshot not found: {path}\n  Download it into backend/ first (see the pull-down steps).")
    # A quick header check catches "downloaded an HTML error page" mistakes.
    with open(path, "rb") as fh:
        if fh.read(16) != b"SQLite format 3\x00":
            sys.exit(f"ERROR: {os.path.basename(path)} is not a SQLite database (wrong/partial download?).")
    try:
        info = _counts(path)
    except (sqlite3.DatabaseError, ValueError) as exc:
        sys.exit(f"ERROR: Snapshot is unusable: {exc}")
    return info


def _ensure_not_locked() -> None:
    """Abort early if dev.db is open (backend running). On Windows an open file can't be
    replaced, so the swap would fail half-done; renaming it is the truest test of that."""
    if not os.path.exists(DEV_DB):
        return
    probe = DEV_DB + ".locktest"
    try:
        os.rename(DEV_DB, probe)   # fails with WinError 32 if the backend holds it open
        os.rename(probe, DEV_DB)   # immediately put it back
    except OSError:
        # Best effort to undo a half-rename (extremely unlikely to be needed).
        if os.path.exists(probe) and not os.path.exists(DEV_DB):
            os.rename(probe, DEV_DB)
        sys.exit(
            "ERROR: dev.db is in use - the backend is probably running.\n"
            "  Stop the backend (close its terminal / Ctrl-C), then re-run this script."
        )


def _print_counts(label: str, info: dict) -> None:
    print(f"  {label}: {info['customers']} customers | {info['tickets']} tickets "
          f"| {info['ticket_updates']} lifecycle rows | {info['users']} users")


def do_restore() -> None:
    backups = sorted(glob.glob(os.path.join(HERE, "dev-backup-*.db")))
    if not backups:
        sys.exit("ERROR: No dev-backup-*.db files to restore from.")
    newest = backups[-1]
    _ensure_not_locked()
    print(f"Restoring dev.db from the newest backup: {os.path.basename(newest)}")
    for s in SIDECARS:
        if os.path.exists(s):
            os.remove(s)
    shutil.copy2(newest, DEV_DB)
    _print_counts("dev.db now", _counts(DEV_DB))
    print("OK  Restored. Restart the backend to pick it up.")


def main() -> None:
    ap = argparse.ArgumentParser(description="Swap a live DB snapshot in as local dev.db.")
    ap.add_argument("snapshot", nargs="?", default="live-snapshot.db",
                    help="snapshot file (default: live-snapshot.db, relative to backend/)")
    ap.add_argument("--dry-run", action="store_true", help="inspect only; change nothing")
    ap.add_argument("--restore", action="store_true", help="roll dev.db back to the newest backup")
    ap.add_argument("--force", action="store_true", help="allow swapping in an empty snapshot")
    args = ap.parse_args()

    if args.restore:
        do_restore()
        return

    snap = args.snapshot if os.path.isabs(args.snapshot) else os.path.join(HERE, args.snapshot)
    info = _validate_snapshot(snap)

    print(f"Snapshot: {os.path.basename(snap)}")
    _print_counts("contains", info)
    print(f"  users: {', '.join(info['usernames']) or '(none)'}")

    if os.path.exists(DEV_DB):
        try:
            _print_counts("current dev.db", _counts(DEV_DB))
        except Exception:  # noqa: BLE001 - a corrupt/locked dev.db shouldn't block the swap
            print("  current dev.db: (unreadable)")

    if info["customers"] == 0 and info["tickets"] == 0 and not args.force:
        sys.exit("ERROR: Snapshot has no customers and no tickets. Wrong file? Re-run with --force to override.")

    if args.dry_run:
        print("\n(dry run - nothing changed)")
        return

    # Fail fast if dev.db is locked, BEFORE making a backup or touching anything.
    _ensure_not_locked()

    # 1. Back up the current dev.db.
    if os.path.exists(DEV_DB):
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = os.path.join(HERE, f"dev-backup-{stamp}.db")
        shutil.copy2(DEV_DB, backup)
        print(f"\nOK  Backed up current dev.db -> {os.path.basename(backup)}")

    # 2. Remove stale WAL/SHM sidecars from the OLD db (they belong to the file being replaced).
    for s in SIDECARS:
        if os.path.exists(s):
            os.remove(s)

    # 3. Swap the snapshot in.
    shutil.copy2(snap, DEV_DB)
    print(f"OK  Swapped {os.path.basename(snap)} in as dev.db")

    # 4. Verify by reading the freshly-installed file.
    _print_counts("dev.db now", _counts(DEV_DB))

    print("\nNext:")
    print("  1. Restart the backend so it opens the new file.")
    print("  2. Log in with a LIVE-site account (the snapshot carries live users/passwords).")
    print("  3. Optional: rebuild the AI index -> POST /api/v1/ai/reindex (as Engineer/Admin).")
    print("  Roll back any time with:  python pull_from_live.py --restore")


if __name__ == "__main__":
    main()
