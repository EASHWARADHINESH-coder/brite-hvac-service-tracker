"""RAG orchestration: turn tickets/customers into documents, index them into the vector
store, and retrieve the most relevant ones for a query or a given ticket.

Powers two features: a "find similar past tickets" tool and grounding for the assistant.
Indexing is incremental (content-hash) and idempotent.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from sqlmodel import Session, select

from app.models.ai_ops import AIDocument
from app.models.masters import Customer
from app.models.tickets import Ticket
from app.services.ai import embeddings, vectorstore
from app.services.ai.metrics import track
from app.services.ticket_logic import primary_complaint_of


@dataclass
class Retrieved:
    kind: str
    ref_id: int
    label: str
    text: str
    distance: float


def _ticket_text(session: Session, t: Ticket) -> str:
    cust = session.get(Customer, t.customer_id)
    complaint = primary_complaint_of(t.updates) or "-"
    remarks = " | ".join(u.remarks for u in t.updates if u.remarks)
    return (
        f"Ticket {t.ticket_no} | Customer: {cust.name if cust else '-'} "
        f"| Work: {t.work_type.value} | Machine: {t.machine_type.value if t.machine_type else '-'} "
        f"| Complaint: {complaint} | Skill: {t.skill or '-'} | Status: {t.status.value}"
        + (f" | Notes: {remarks}" if remarks else "")
    )


def _customer_text(c: Customer) -> str:
    parts = [f"Customer {c.name}"]
    if c.city:
        parts.append(f"City: {c.city}")
    if c.address:
        parts.append(f"Address: {c.address}")
    return " | ".join(parts)


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _upsert_document(session: Session, kind: str, ref_id: int, text: str) -> str:
    """Create/update the AIDocument + its vector. Returns 'indexed' | 'skipped' | 'failed'."""
    doc = session.exec(
        select(AIDocument).where(AIDocument.kind == kind, AIDocument.ref_id == ref_id)
    ).first()
    h = _hash(text)
    if doc and doc.content_hash == h:
        return "skipped"  # unchanged since last index

    vec = embeddings.embed(text)
    if vec is None:
        return "failed"  # embeddings unavailable

    if doc is None:
        doc = AIDocument(kind=kind, ref_id=ref_id, text=text, content_hash=h)
        session.add(doc)
    else:
        doc.text = text
        doc.content_hash = h
    session.commit()
    session.refresh(doc)
    vectorstore.upsert(doc.id, vec)
    return "indexed"


def index_all(session: Session) -> dict:
    """(Re)index every ticket and customer. Incremental via content hash."""
    vectorstore.ensure_table()
    indexed = skipped = failed = 0

    for t in session.exec(select(Ticket)).all():
        r = _upsert_document(session, "ticket", t.id, _ticket_text(session, t))
        indexed += r == "indexed"
        skipped += r == "skipped"
        failed += r == "failed"

    for c in session.exec(select(Customer)).all():
        r = _upsert_document(session, "customer", c.id, _customer_text(c))
        indexed += r == "indexed"
        skipped += r == "skipped"
        failed += r == "failed"

    return {"indexed": indexed, "skipped": skipped, "failed": failed}


def retrieve(session: Session, query: str, k: int = 5, kind: str | None = None) -> list[Retrieved]:
    """Semantic search over the indexed corpus."""
    vec = embeddings.embed(query)
    if vec is None:
        return []
    with track("retrieve", provider="ollama"):
        hits = vectorstore.search(vec, k=k * 3 if kind else k)
    out: list[Retrieved] = []
    for doc_id, dist in hits:
        doc = session.get(AIDocument, doc_id)
        if not doc or (kind and doc.kind != kind):
            continue
        out.append(Retrieved(doc.kind, doc.ref_id, _label(session, doc), doc.text, round(dist, 4)))
        if len(out) >= k:
            break
    return out


def similar_tickets(session: Session, ticket_id: int, k: int = 5) -> list[Retrieved]:
    """Past tickets most similar to the given one (itself excluded)."""
    t = session.get(Ticket, ticket_id)
    if not t:
        return []
    results = retrieve(session, _ticket_text(session, t), k=k + 1, kind="ticket")
    return [r for r in results if r.ref_id != ticket_id][:k]


def _label(session: Session, doc: AIDocument) -> str:
    if doc.kind == "ticket":
        t = session.get(Ticket, doc.ref_id)
        return t.ticket_no if t else f"ticket#{doc.ref_id}"
    c = session.get(Customer, doc.ref_id)
    return c.name if c else f"customer#{doc.ref_id}"
