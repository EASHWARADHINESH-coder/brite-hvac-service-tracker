"""Async job runner (Principle 5 — Queues & Async).

Reindexing embeds every ticket/customer and can take a while, so it runs off the request
thread as a background job with a status row clients can poll. A daemon thread is enough at
this scale (no Redis/Celery — no extra cost); the pattern generalises to a real queue later.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime

from sqlmodel import Session, select

from app.database import engine
from app.models.ai_ops import AIJob
from app.services.ai import rag

logger = logging.getLogger(__name__)


def enqueue_reindex() -> int:
    """Create a queued reindex job and start it in the background. Returns the job id."""
    with Session(engine) as s:
        # Coalesce: if one is already queued/running, return it instead of piling on.
        active = s.exec(
            select(AIJob).where(AIJob.kind == "reindex", AIJob.status.in_(["queued", "running"]))
        ).first()
        if active:
            return active.id
        job = AIJob(kind="reindex", status="queued")
        s.add(job)
        s.commit()
        s.refresh(job)
        job_id = job.id

    threading.Thread(target=_run_reindex, args=(job_id,), daemon=True).start()
    return job_id


def _set(job_id: int, **fields) -> None:
    with Session(engine) as s:
        job = s.get(AIJob, job_id)
        if not job:
            return
        for k, v in fields.items():
            setattr(job, k, v)
        s.add(job)
        s.commit()


def _run_reindex(job_id: int) -> None:
    _set(job_id, status="running")
    try:
        with Session(engine) as s:
            stats = rag.index_all(s)
        detail = (
            f"indexed {stats['indexed']}, skipped {stats['skipped']}, "
            f"failed {stats['failed']}, pruned {stats['pruned']}"
        )
        _set(job_id, status="done", detail=detail, finished_at=datetime.utcnow())
    except Exception as exc:  # noqa: BLE001
        logger.exception("reindex job failed")
        _set(job_id, status="failed", detail=str(exc)[:300], finished_at=datetime.utcnow())


def get_job(session: Session, job_id: int) -> AIJob | None:
    return session.get(AIJob, job_id)
