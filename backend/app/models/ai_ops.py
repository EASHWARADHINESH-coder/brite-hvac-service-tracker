"""Operational tables for the AI layer: metrics (monitoring) and jobs (async queue)."""

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class AIMetric(SQLModel, table=True):
    """One row per AI operation — powers the /ai/metrics dashboard (Principle 6: Monitoring)."""

    __tablename__ = "ai_metric"

    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    operation: str = Field(index=True)        # chat · embed · assistant · agent · rank · retrieve
    provider: Optional[str] = None            # ollama | groq
    model: Optional[str] = None
    latency_ms: int = 0
    cache_hit: bool = False
    ok: bool = True
    error: Optional[str] = None


class AIDocument(SQLModel, table=True):
    """A text document in the RAG corpus (a ticket or customer), mirrored into the
    sqlite-vec vector table by rowid=id. Content hash makes reindexing incremental."""

    __tablename__ = "ai_document"

    id: Optional[int] = Field(default=None, primary_key=True)
    kind: str = Field(index=True)              # ticket | customer
    ref_id: int = Field(index=True)            # Ticket.id / Customer.id
    text: str
    content_hash: str = Field(index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AIJob(SQLModel, table=True):
    """A background AI job (e.g. reindex) — powers async processing (Principle 5: Queues)."""

    __tablename__ = "ai_job"

    id: Optional[int] = Field(default=None, primary_key=True)
    kind: str                                  # "reindex"
    status: str = Field(default="queued", index=True)  # queued | running | done | failed
    created_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: Optional[datetime] = None
    detail: Optional[str] = None               # human-readable progress/summary
