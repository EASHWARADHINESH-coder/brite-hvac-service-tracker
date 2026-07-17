"""MCP server exposing the Service Tracker's read-only operations as tools.

FastMCP over the service layer: each tool opens a DB session and calls the app's existing
services/handlers directly (in-process, no HTTP), acting as a privileged Service Admin
identity so all org data is visible. Every tool is READ-ONLY — nothing here mutates data.
The semantic tools (search_tickets, find_similar_tickets) use the RAG layer and return empty
if the AI layer / Ollama is off.

Two transports share the same tools:
  * stdio  — `python -m app.mcp_server` (local clients like Claude Desktop on this machine)
  * HTTP   — `http_app()` is mounted by main.py at /mcp (remote clients, the deployed website),
             behind a bearer-token guard. Enable with MCP_HTTP_ENABLED + MCP_TOKEN.
"""

from sqlmodel import Session, select

from app.core.enums import UserRole
from app.database import create_db_and_tables, engine
from app.models.masters import Customer
from app.models.tickets import Ticket
from app.models.user import User
from app.services.ai import rag
from app.services.materials_ledger import stock_levels as stock_levels_service

# Reuse existing read handlers (the router decorators return the plain functions).
from app.api.v1 import dashboard
from app.api.v1 import payments as payments_api
from app.api.v1 import pms as pms_api
from app.api.v1 import tickets as tickets_api

try:
    from mcp.server.fastmcp import FastMCP
except ImportError as exc:  # pragma: no cover
    raise SystemExit("The 'mcp' package is required — run: pip install -r requirements.txt") from exc

# stateless_http: each HTTP request is independent (no server-side session state to keep) —
# simplest and most robust for tool calls behind a reverse proxy. Path "/" so the app can be
# mounted at /mcp by the FastAPI parent.
mcp = FastMCP("service-tracker", stateless_http=True, streamable_http_path="/")


def _admin() -> User:
    """A non-persisted privileged identity used only for data scoping (sees all org data)."""
    return User(username="mcp", hashed_password="x", role=UserRole.SERVICE_ADMIN, is_active=True)


@mcp.tool()
def dashboard_overview() -> dict:
    """Org-wide snapshot: ticket counts by status and work type, attention items (assignment
    overdue, payments pending, open queries/claims, PMS visits due) and the contract mix."""
    with Session(engine) as s:
        return dashboard.overview(s, _admin())


@mcp.tool()
def search_tickets(query: str, limit: int = 8) -> list[dict]:
    """Find tickets by a natural-language description of the problem (semantic search via RAG),
    or by ticket number / customer name. Returns the closest matching tickets."""
    out: list[dict] = []
    with Session(engine) as s:
        for r in rag.retrieve(s, query, k=limit, kind="ticket"):
            out.append({"ticket_no": r.label, "match": round(r.distance, 3), "summary": r.text})
        if out:
            return out
        # Fallback when the RAG index is empty / AI is off: literal match.
        names = {c.id: c.name for c in s.exec(select(Customer)).all()}
        q = query.lower()
        for t in s.exec(select(Ticket)).all():
            cn = names.get(t.customer_id) or ""
            if q in t.ticket_no.lower() or q in cn.lower():
                out.append({"ticket_no": t.ticket_no, "customer": cn,
                            "work_type": t.work_type.value, "status": t.status.value})
                if len(out) >= limit:
                    break
    return out


@mcp.tool()
def get_ticket(ticket: str) -> dict:
    """Full detail for one ticket by number (e.g. 'B2026070801') or numeric id — metadata,
    the lifecycle timeline, and payment fields."""
    with Session(engine) as s:
        t = s.get(Ticket, int(ticket)) if ticket.isdigit() else \
            s.exec(select(Ticket).where(Ticket.ticket_no == ticket)).first()
        if t is None:
            return {"error": f"No ticket matching '{ticket}'."}
        return tickets_api._ticket_detail(s, t).model_dump(mode="json")


@mcp.tool()
def stock_levels() -> list[dict]:
    """Current material stock per item: received, consumed, available, and pending allocations."""
    with Session(engine) as s:
        return stock_levels_service(s)


@mcp.tool()
def pms_due() -> list[dict]:
    """PMS visits that are due (scheduled on/before today) and not yet turned into a ticket."""
    with Session(engine) as s:
        return [r.model_dump(mode="json") for r in pms_api.pms_schedule(s) if r.status == "Due"]


@mcp.tool()
def payment_follow_up() -> list[dict]:
    """Repaired-Service tickets that still have an outstanding balance (payment follow-up)."""
    with Session(engine) as s:
        return [r.model_dump(mode="json") for r in payments_api.follow_up(s)]


@mcp.tool()
def daily_briefing() -> dict:
    """Today's operations briefing: tickets overdue for assignment, closed tickets with a
    pending Blue Star MR, PMS visits due, and payment follow-ups — plus a short summary."""
    from app.services.ai import briefing
    with Session(engine) as s:
        return briefing.daily_briefing(s)


@mcp.tool()
def find_similar_tickets(ticket: str, limit: int = 5) -> list[dict]:
    """Past tickets semantically similar to a given ticket (by number or id) — useful for
    diagnosing a new complaint. Needs the RAG index; returns empty if AI/Ollama is off."""
    with Session(engine) as s:
        t = s.get(Ticket, int(ticket)) if ticket.isdigit() else \
            s.exec(select(Ticket).where(Ticket.ticket_no == ticket)).first()
        if t is None:
            return []
        return [{"ticket_no": r.label, "match": round(r.distance, 3), "summary": r.text}
                for r in rag.similar_tickets(s, t.id, k=limit)]


def http_app():
    """ASGI app for the streamable-HTTP transport (mounted at /mcp by main.py).

    Creates the session manager lazily; main.py runs it via mcp.session_manager.run().
    """
    return mcp.streamable_http_app()


def main() -> None:
    create_db_and_tables()  # ensure tables exist even if the web app never ran
    mcp.run()               # stdio transport by default


if __name__ == "__main__":
    main()
