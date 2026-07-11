"""CLI: import customers from the monthly PMS sheet.

    python -m app.import_pms "path/to/Jul 2026 PMS Schedule ....xlsx" [--sheet "Jul 2026 PMS"]

Idempotent — safe to re-run; existing customers (by CRM id) are skipped.
"""

import argparse

from sqlmodel import Session

from app.database import engine
from app.services.imports import ensure_schema, import_pms


def main() -> None:
    ap = argparse.ArgumentParser(description="Import customers from the PMS Excel sheet.")
    ap.add_argument("path", help="Path to the .xlsx file")
    ap.add_argument("--sheet", default="Jul 2026 PMS", help="Worksheet name")
    args = ap.parse_args()

    ensure_schema(engine)
    with Session(engine) as session:
        stats = import_pms(session, args.path, sheet=args.sheet)
    print(f"PMS import: created {stats['created']} customer(s), skipped {stats['skipped']} duplicate(s).")


if __name__ == "__main__":
    main()
