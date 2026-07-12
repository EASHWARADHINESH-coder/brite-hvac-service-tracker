"""sqlite-vec vector store — the storage/query side of the RAG layer.

A single `ai_vec` virtual table (vec0) holds the embeddings, keyed by rowid = AIDocument.id,
so a KNN search returns document ids we can join back to tickets/customers. Lives in the same
SQLite database as everything else — no extra service, no cost.
"""

from __future__ import annotations

import logging
import struct

from app.core.config import get_settings
from app.database import engine

logger = logging.getLogger(__name__)


def _serialize(vec: list[float]) -> bytes:
    """Pack floats as little-endian float32 (the format vec0 expects)."""
    return struct.pack("<%df" % len(vec), *vec)


def vec_available() -> bool:
    """Whether the sqlite-vec extension is loaded on our connections."""
    try:
        with engine.connect() as conn:
            conn.exec_driver_sql("SELECT vec_version()")
        return True
    except Exception:  # noqa: BLE001
        return False


def ensure_table() -> None:
    """Create the vec0 table if missing (dimension from config)."""
    dim = get_settings().ollama_embed_dim
    with engine.begin() as conn:
        conn.exec_driver_sql(
            f"CREATE VIRTUAL TABLE IF NOT EXISTS ai_vec USING vec0(embedding float[{dim}])"
        )


def upsert(doc_id: int, vec: list[float]) -> None:
    with engine.begin() as conn:
        conn.exec_driver_sql("DELETE FROM ai_vec WHERE rowid = ?", (doc_id,))
        conn.exec_driver_sql(
            "INSERT INTO ai_vec(rowid, embedding) VALUES (?, ?)", (doc_id, _serialize(vec))
        )


def delete(doc_id: int) -> None:
    with engine.begin() as conn:
        conn.exec_driver_sql("DELETE FROM ai_vec WHERE rowid = ?", (doc_id,))


def search(vec: list[float], k: int = 5) -> list[tuple[int, float]]:
    """KNN: return [(doc_id, distance)] for the k nearest stored vectors.

    Note: sqlite-vec's KNN needs the `k` as a literal LIMIT (a bound parameter yields no
    rows), so we inline it — safe because k is a validated int we control, never user text.
    """
    k = max(1, int(k))
    with engine.connect() as conn:
        rows = conn.exec_driver_sql(
            "SELECT rowid, distance FROM ai_vec "
            f"WHERE embedding MATCH ? ORDER BY distance LIMIT {k}",
            (_serialize(vec),),
        ).fetchall()
    return [(int(r[0]), float(r[1])) for r in rows]


def count() -> int:
    try:
        with engine.connect() as conn:
            return int(conn.exec_driver_sql("SELECT count(*) FROM ai_vec").scalar() or 0)
    except Exception:  # noqa: BLE001 — table not created yet
        return 0
