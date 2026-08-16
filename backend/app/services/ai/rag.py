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
from app.models.masters import Customer, MaterialItem
from app.models.material_claim import MaterialClaim
from app.models.material_ledger import MaterialInward, MaterialIssue
from app.models.pms import PMS
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


def _pms_text(session: Session, p: PMS) -> str:
    cust = session.get(Customer, p.customer_id)
    parts = [
        f"PMS work order {p.wo_number}",
        f"Customer: {cust.name if cust else '-'}",
        f"Schedule: {p.schedule or '-'}",
        f"Service: {p.complaint or 'General Service'}",
    ]
    if p.wo_start_date and p.wo_end_date:
        parts.append(f"WO period: {p.wo_start_date} to {p.wo_end_date}")
    return " | ".join(parts)


def _claim_text(session: Session, c: MaterialClaim) -> str:
    ticket = session.get(Ticket, c.ticket_id)
    cust = session.get(Customer, c.customer_id) if c.customer_id else None
    parts = [
        f"Material claim {c.claim_no}",
        f"Ticket: {ticket.ticket_no if ticket else '-'}",
        f"Customer: {cust.name if cust else '-'}",
        f"Material: {c.material_name} ({c.qty:g} {c.uom})",
        f"Status: {c.status.value}",
    ]
    if c.mr_no:
        parts.append(f"MR: {c.mr_no}")
    return " | ".join(parts)


def _stock_by_name(session: Session) -> dict[str, dict]:
    """Current stock keyed by material name (lazy import avoids an import cycle)."""
    from app.services.materials_ledger import stock_levels
    return {r["material_name"]: r for r in stock_levels(session)}


def _material_text(item: MaterialItem, stock: dict[str, dict]) -> str:
    """Catalog item + its live stock, so 'how much R410A do we have' is searchable.
    The quantity is a point-in-time snapshot, refreshed whenever the ledger moves."""
    parts = [f"Material {item.name}", f"Unit: {item.uom}"]
    st = stock.get(item.name)
    if st:
        parts.append(
            f"Stock: {st['available']:g} {item.uom} available "
            f"(received {st['received']:g}, consumed {st['consumed']:g})"
        )
    else:
        parts.append("Stock: none received yet")
    return " | ".join(parts)


def _inward_text(inw: MaterialInward) -> str:
    parts = [
        f"Material inward {inw.inward_no}",
        f"Source: {inw.source_type.value}",
        f"Material: {inw.material_name} ({inw.qty:g} {inw.uom})",
        f"Received: {inw.received_date}",
    ]
    if inw.supplier:
        parts.append(f"Supplier: {inw.supplier}")
    if inw.doc_no:
        parts.append(f"Doc: {inw.doc_no}")
    return " | ".join(parts)


def _issue_text(session: Session, iss: MaterialIssue) -> str:
    ticket = session.get(Ticket, iss.ticket_id)
    parts = [
        f"Material issue {iss.issue_no}",
        f"Ticket: {ticket.ticket_no if ticket else '-'}",
        f"Material: {iss.material_name} ({iss.qty:g} {iss.uom})",
        f"Status: {iss.status.value}",
        f"Outcome: {iss.outcome.value if iss.outcome else 'Allocated'}",
    ]
    if iss.delivery_note_no:
        parts.append(f"Delivery note: {iss.delivery_note_no}")
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


def index_ticket(session: Session, ticket_id: int) -> str:
    """(Re)index a single ticket. Returns 'indexed' | 'skipped' | 'failed' | 'missing'."""
    vectorstore.ensure_table()
    t = session.get(Ticket, ticket_id)
    if t is None:
        return "missing"
    return _upsert_document(session, "ticket", t.id, _ticket_text(session, t))


def index_customer(session: Session, customer_id: int) -> str:
    """(Re)index a single customer. Returns 'indexed' | 'skipped' | 'failed' | 'missing'."""
    vectorstore.ensure_table()
    c = session.get(Customer, customer_id)
    if c is None:
        return "missing"
    return _upsert_document(session, "customer", c.id, _customer_text(c))


def index_pms(session: Session, pms_id: int) -> str:
    """(Re)index a single PMS work order."""
    vectorstore.ensure_table()
    p = session.get(PMS, pms_id)
    if p is None:
        return "missing"
    return _upsert_document(session, "pms", p.id, _pms_text(session, p))


def index_claim(session: Session, claim_id: int) -> str:
    """(Re)index a single Blue Star material claim."""
    vectorstore.ensure_table()
    c = session.get(MaterialClaim, claim_id)
    if c is None:
        return "missing"
    return _upsert_document(session, "claim", c.id, _claim_text(session, c))


def index_material(session: Session, item_id: int, stock: dict[str, dict] | None = None) -> str:
    """(Re)index a catalog material with its current stock level."""
    vectorstore.ensure_table()
    item = session.get(MaterialItem, item_id)
    if item is None:
        return "missing"
    stock = stock if stock is not None else _stock_by_name(session)
    return _upsert_document(session, "material", item.id, _material_text(item, stock))


def index_material_by_name(session: Session, name: str) -> str:
    """Re-index the catalog item matching `name` (used after a ledger move changes its stock)."""
    from sqlmodel import func
    item = session.exec(
        select(MaterialItem).where(func.lower(MaterialItem.name) == name.lower())
    ).first()
    return index_material(session, item.id) if item else "no-item"


def index_inward(session: Session, inward_id: int) -> str:
    """(Re)index a single materials-inward (receipt) row."""
    vectorstore.ensure_table()
    inw = session.get(MaterialInward, inward_id)
    if inw is None:
        return "missing"
    return _upsert_document(session, "inward", inw.id, _inward_text(inw))


def index_issue(session: Session, issue_id: int) -> str:
    """(Re)index a single materials-issue (allocation/delivery) row."""
    vectorstore.ensure_table()
    iss = session.get(MaterialIssue, issue_id)
    if iss is None:
        return "missing"
    return _upsert_document(session, "issue", iss.id, _issue_text(session, iss))


def drop_document(session: Session, kind: str, ref_id: int) -> bool:
    """Remove a deleted row from the index so search stops returning it."""
    doc = session.exec(
        select(AIDocument).where(AIDocument.kind == kind, AIDocument.ref_id == ref_id)
    ).first()
    if doc is None:
        return False
    vectorstore.delete(doc.id)
    session.delete(doc)
    session.commit()
    return True


def index_all(session: Session) -> dict:
    """(Re)index every ticket and customer, and prune deleted ones.

    Incremental via content hash. Documents whose source row no longer exists (e.g. a
    removed PMS ticket) are dropped along with their vectors, so search never surfaces
    records that aren't there any more.
    """
    vectorstore.ensure_table()
    indexed = skipped = failed = 0
    live: set[tuple[str, int]] = set()

    for t in session.exec(select(Ticket)).all():
        live.add(("ticket", t.id))
        r = _upsert_document(session, "ticket", t.id, _ticket_text(session, t))
        indexed += r == "indexed"
        skipped += r == "skipped"
        failed += r == "failed"

    for c in session.exec(select(Customer)).all():
        live.add(("customer", c.id))
        r = _upsert_document(session, "customer", c.id, _customer_text(c))
        indexed += r == "indexed"
        skipped += r == "skipped"
        failed += r == "failed"

    for p in session.exec(select(PMS)).all():
        live.add(("pms", p.id))
        r = _upsert_document(session, "pms", p.id, _pms_text(session, p))
        indexed += r == "indexed"
        skipped += r == "skipped"
        failed += r == "failed"

    for cl in session.exec(select(MaterialClaim)).all():
        live.add(("claim", cl.id))
        r = _upsert_document(session, "claim", cl.id, _claim_text(session, cl))
        indexed += r == "indexed"
        skipped += r == "skipped"
        failed += r == "failed"

    stock = _stock_by_name(session)
    for item in session.exec(select(MaterialItem)).all():
        live.add(("material", item.id))
        r = _upsert_document(session, "material", item.id, _material_text(item, stock))
        indexed += r == "indexed"
        skipped += r == "skipped"
        failed += r == "failed"

    for inw in session.exec(select(MaterialInward)).all():
        live.add(("inward", inw.id))
        r = _upsert_document(session, "inward", inw.id, _inward_text(inw))
        indexed += r == "indexed"
        skipped += r == "skipped"
        failed += r == "failed"

    for iss in session.exec(select(MaterialIssue)).all():
        live.add(("issue", iss.id))
        r = _upsert_document(session, "issue", iss.id, _issue_text(session, iss))
        indexed += r == "indexed"
        skipped += r == "skipped"
        failed += r == "failed"

    pruned = 0
    for doc in session.exec(select(AIDocument)).all():
        if (doc.kind, doc.ref_id) not in live:
            vectorstore.delete(doc.id)
            session.delete(doc)
            pruned += 1
    if pruned:
        session.commit()

    return {"indexed": indexed, "skipped": skipped, "failed": failed, "pruned": pruned}


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
    if doc.kind == "pms":
        p = session.get(PMS, doc.ref_id)
        return p.wo_number if p else f"pms#{doc.ref_id}"
    if doc.kind == "claim":
        cl = session.get(MaterialClaim, doc.ref_id)
        return cl.claim_no if cl else f"claim#{doc.ref_id}"
    if doc.kind == "material":
        m = session.get(MaterialItem, doc.ref_id)
        return m.name if m else f"material#{doc.ref_id}"
    if doc.kind == "inward":
        inw = session.get(MaterialInward, doc.ref_id)
        return inw.inward_no if inw else f"inward#{doc.ref_id}"
    if doc.kind == "issue":
        iss = session.get(MaterialIssue, doc.ref_id)
        return iss.issue_no if iss else f"issue#{doc.ref_id}"
    c = session.get(Customer, doc.ref_id)
    return c.name if c else f"customer#{doc.ref_id}"
