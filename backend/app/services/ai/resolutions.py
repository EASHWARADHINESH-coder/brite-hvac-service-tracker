"""'What fixed it last time' — enrich semantically-similar past tickets with how they were
resolved and which spare parts were used. Deterministic (reads the lifecycle + claims); the
semantic match comes from the RAG layer. No LLM call, so it's instant and can't invent a fix.
"""

from __future__ import annotations

from datetime import date

from sqlmodel import Session, select

from app.core.enums import LifecycleStage
from app.models.masters import Customer
from app.models.material_claim import MaterialClaim
from app.models.tickets import Ticket
from app.services.ai import rag
from app.services.ticket_logic import primary_complaint_of

_EMPTY = {"", "nil", "none", "-", "na", "n/a"}


def _clean(vals: list[str | None]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in vals:
        if not v:
            continue
        s = v.strip()
        if s and s.lower() not in _EMPTY and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
    return out


def _resolution(ticket: Ticket) -> str | None:
    """A short 'what was done' summary — prefers Closed/T&C notes, else the last remark."""
    updates = sorted(ticket.updates, key=lambda u: u.id or 0)
    bits: list[str | None] = []
    for u in updates:
        if u.stage in (LifecycleStage.CLOSED, LifecycleStage.TESTING_COMMISSIONING):
            bits.append(u.remarks)
            bits.append(u.complaints)
    cleaned = _clean(bits)
    if not cleaned:  # nothing at close — fall back to the most recent remark
        for u in reversed(updates):
            if u.remarks and u.remarks.strip().lower() not in _EMPTY:
                cleaned = [u.remarks.strip()]
                break
    return " · ".join(cleaned) or None


def _parts(session: Session, ticket: Ticket) -> list[str]:
    """Spare parts used: Blue Star claims + any non-BSL materials noted on the lifecycle."""
    parts: list[str] = []
    claims = session.exec(
        select(MaterialClaim).where(MaterialClaim.ticket_id == ticket.id)
    ).all()
    for c in claims:
        qty = f" ×{c.qty:g}" if c.qty else ""
        parts.append(f"{c.material_name}{qty}")
    for u in ticket.updates:
        # Skip the auto-generated BSL claim note on the lifecycle row — the clean claim name is
        # already listed above; keep only genuine free-text (non-BSL / vendor) materials.
        if u.materials and "claim clm" not in u.materials.lower() and not u.materials.lower().startswith("bsl mr"):
            parts.append(u.materials)
    return _clean(parts)


def _closed_on(ticket: Ticket) -> str | None:
    ends = [u.end_date for u in ticket.updates if u.end_date is not None]
    return max(ends).isoformat() if ends else None


def what_fixed_it(session: Session, ticket_id: int, k: int = 4) -> list[dict]:
    """Similar past tickets, each with its resolution + parts. Resolved (closed / has a fix)
    ones are surfaced first — that's where the useful history is."""
    # Pull a few extra candidates so we can prefer the ones that actually have a resolution.
    hits = rag.similar_tickets(session, ticket_id, k=k * 3)
    customers = {c.id: c for c in session.exec(select(Customer)).all()}

    rows: list[dict] = []
    for h in hits:
        t = session.get(Ticket, h.ref_id)
        if not t:
            continue
        resolution = _resolution(t)
        parts = _parts(session, t)
        cust = customers.get(t.customer_id)
        rows.append({
            "ticket_id": t.id,
            "ticket_no": t.ticket_no,
            "customer_name": cust.name if cust else None,
            "complaint": primary_complaint_of(sorted(t.updates, key=lambda u: u.id or 0)),
            "machine_type": t.machine_type.value if t.machine_type else None,
            "status": t.status.value,
            "closed_on": _closed_on(t),
            "resolution": resolution,
            "parts": parts,
            "distance": h.distance,
            "_has_fix": bool(resolution or parts),
        })

    # Resolved/with-a-fix first, then by similarity (smaller distance = closer).
    rows.sort(key=lambda r: (not r["_has_fix"], r["distance"]))
    for r in rows:
        r.pop("_has_fix", None)
    return rows[:k]
