"""Keep the vector index fresh as data changes.

Search is only trustworthy if it reflects what's in the database *now*. A manual reindex
means every new ticket is invisible to semantic search until someone remembers to press a
button, so writes schedule their own re-index instead.

Three rules make this safe to call from any handler:

  * **Never blocks the response.** Embedding takes ~180ms and can spike to ~3s, which is far
    too long to sit inside a ticket save. Work happens on a daemon thread.
  * **Never fails the write.** If Ollama is down or the AI layer is off, indexing is skipped
    and logged — creating a ticket must not depend on a model being up.
  * **Its own session.** The request's session is closed by the time the thread runs, so a
    fresh one is opened against the engine.

Indexing is content-hash incremental (see rag._upsert_document), so re-scheduling the same
unchanged row is cheap — it embeds nothing and returns "skipped".
"""

from __future__ import annotations

import logging
import threading

from sqlmodel import Session

from app.core.config import get_settings
from app.database import engine
from app.services.ai import rag

logger = logging.getLogger(__name__)


def _run(fn, label: str) -> None:
    try:
        with Session(engine) as session:
            result = fn(session)
        logger.debug("auto-index %s -> %s", label, result)
    except Exception:  # noqa: BLE001 — indexing must never surface to the caller
        logger.warning("auto-index failed for %s", label, exc_info=True)


def _spawn(fn, label: str) -> None:
    if not get_settings().ai_enabled:
        return
    threading.Thread(target=_run, args=(fn, label), daemon=True).start()


def ticket_changed(ticket_id: int) -> None:
    """Call after creating a ticket or appending a lifecycle update."""
    _spawn(lambda s: rag.index_ticket(s, ticket_id), f"ticket#{ticket_id}")


def customer_changed(customer_id: int) -> None:
    """Call after creating or editing a customer."""
    _spawn(lambda s: rag.index_customer(s, customer_id), f"customer#{customer_id}")


def ticket_deleted(ticket_id: int) -> None:
    _spawn(lambda s: rag.drop_document(s, "ticket", ticket_id), f"ticket#{ticket_id} (delete)")


def customer_deleted(customer_id: int) -> None:
    _spawn(lambda s: rag.drop_document(s, "customer", customer_id), f"customer#{customer_id} (delete)")


def pms_changed(pms_id: int) -> None:
    """Call after creating or editing a PMS work order."""
    _spawn(lambda s: rag.index_pms(s, pms_id), f"pms#{pms_id}")


def claim_changed(claim_id: int) -> None:
    """Call after creating or updating a Blue Star material claim."""
    _spawn(lambda s: rag.index_claim(s, claim_id), f"claim#{claim_id}")


def inward_changed(inward_id: int, material_name: str | None = None) -> None:
    """Call after a materials-inward receipt. Also refreshes that material's stock doc."""
    _spawn(lambda s: rag.index_inward(s, inward_id), f"inward#{inward_id}")
    if material_name:
        _spawn(lambda s: rag.index_material_by_name(s, material_name), f"stock '{material_name}'")


def issue_changed(issue_id: int, material_name: str | None = None) -> None:
    """Call after allocating or delivering a materials issue. Also refreshes the stock doc."""
    _spawn(lambda s: rag.index_issue(s, issue_id), f"issue#{issue_id}")
    if material_name:
        _spawn(lambda s: rag.index_material_by_name(s, material_name), f"stock '{material_name}'")
