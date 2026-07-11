"""CLI: import Breakdown tickets from the monthly sheet.

    python -m app.import_breakdown "path/to/....xlsx" [--sheet "Breakdown Status"]

Idempotent — re-running won't duplicate; rows with a Closing Date are auto-closed, and no
second ticket is opened for a customer that already has an open one.
"""

import argparse

from sqlmodel import Session

from app.database import engine
from app.services.imports import ensure_schema, import_breakdown


def main() -> None:
    ap = argparse.ArgumentParser(description="Import Breakdown tickets from the Excel sheet.")
    ap.add_argument("path", help="Path to the .xlsx file")
    ap.add_argument("--sheet", default="Breakdown Status", help="Worksheet name")
    args = ap.parse_args()

    ensure_schema(engine)
    with Session(engine) as session:
        stats = import_breakdown(session, args.path, sheet=args.sheet)
    print(
        f"Breakdown import: created {stats['created']} ticket(s) "
        f"({stats['closed']} auto-closed), skipped {stats['skipped']}."
    )
    for p in stats["problems"]:
        print("  ! " + p)


if __name__ == "__main__":
    main()
