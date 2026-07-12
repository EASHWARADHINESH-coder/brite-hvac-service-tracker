from collections.abc import Generator

from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from app.core.config import get_settings

settings = get_settings()
engine = create_engine(settings.database_url, echo=(settings.env == "development"))


# For SQLite, enable WAL + a generous busy timeout so concurrent readers/writers
# (e.g. the AI metrics/jobs writes alongside request traffic) don't hit "database
# is locked". No-op for Postgres. (Reliability hardening — Phase 6.)
if settings.database_url.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover - simple setup
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=30000")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()
        # Load the sqlite-vec extension so the RAG vector table/queries work on this
        # connection. Optional — if the package isn't installed, RAG just stays disabled.
        try:
            import sqlite_vec

            dbapi_conn.enable_load_extension(True)
            sqlite_vec.load(dbapi_conn)
            dbapi_conn.enable_load_extension(False)
        except Exception:  # noqa: BLE001 — no sqlite-vec -> semantic search unavailable
            pass


def create_db_and_tables() -> None:
    # Importing the models package registers every table on SQLModel.metadata.
    import app.models  # noqa: F401

    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
