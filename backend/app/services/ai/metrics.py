"""Monitoring (Principle 6).

A tiny tracing helper that records one AIMetric row per AI operation (latency, provider,
cache hit, success/error), and an aggregation used by the /ai/metrics dashboard. Recording
never raises into the caller — monitoring must not break the feature it observes.
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager

from sqlmodel import Session, func, select

from app.database import engine
from app.models.ai_ops import AIMetric

logger = logging.getLogger(__name__)


@contextmanager
def track(operation: str, provider: str | None = None, model: str | None = None):
    """Time an AI operation and persist a metric row.

    Yields a mutable dict; set `rec["cache_hit"] = True` when the result came from cache.
    """
    rec = {"cache_hit": False}
    start = time.perf_counter()
    ok = True
    err: str | None = None
    try:
        yield rec
    except Exception as exc:  # noqa: BLE001 — record then re-raise
        ok = False
        err = str(exc)[:300]
        raise
    finally:
        latency = int((time.perf_counter() - start) * 1000)
        try:
            with Session(engine) as s:
                s.add(AIMetric(
                    operation=operation, provider=provider, model=model,
                    latency_ms=latency, cache_hit=bool(rec.get("cache_hit")),
                    ok=ok, error=err,
                ))
                s.commit()
        except Exception:  # noqa: BLE001 — monitoring must never break the caller
            logger.exception("failed to record AI metric")


def summary(session: Session, limit_recent: int = 10) -> dict:
    """Aggregate metrics for the dashboard: totals, per-operation latency, recent errors."""
    total = session.exec(select(func.count()).select_from(AIMetric)).one()
    if not total:
        return {"total": 0, "by_operation": [], "recent_errors": [], "error_rate": 0.0}

    errors = session.exec(
        select(func.count()).select_from(AIMetric).where(AIMetric.ok == False)  # noqa: E712
    ).one()
    cache_hits = session.exec(
        select(func.count()).select_from(AIMetric).where(AIMetric.cache_hit == True)  # noqa: E712
    ).one()

    rows = session.exec(
        select(
            AIMetric.operation,
            func.count().label("n"),
            func.avg(AIMetric.latency_ms).label("avg_ms"),
            func.max(AIMetric.latency_ms).label("max_ms"),
        ).group_by(AIMetric.operation)
    ).all()
    by_operation = [
        {"operation": r[0], "count": r[1], "avg_ms": round(r[2] or 0, 1), "max_ms": r[3]}
        for r in rows
    ]

    recent_errors = [
        {"operation": m.operation, "error": m.error, "at": m.created_at.isoformat()}
        for m in session.exec(
            select(AIMetric).where(AIMetric.ok == False)  # noqa: E712
            .order_by(AIMetric.created_at.desc()).limit(limit_recent)
        ).all()
    ]

    return {
        "total": total,
        "errors": errors,
        "error_rate": round(errors / total, 3),
        "cache_hits": cache_hits,
        "cache_hit_rate": round(cache_hits / total, 3),
        "by_operation": by_operation,
        "recent_errors": recent_errors,
    }
