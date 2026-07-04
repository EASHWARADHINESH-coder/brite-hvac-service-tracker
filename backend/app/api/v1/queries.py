"""Staff queries — anyone can raise; Admin/Engineer see all and resolve.

Technician/Helper see only their own queries. A query may reference a ticket.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep, get_current_user, require_engineer
from app.core.enums import QueryStatus
from app.models.query import Query
from app.models.tickets import Ticket
from app.models.user import User
from app.schemas.query import QueryCreate, QueryRead, QueryResolve
from app.services.permissions import is_privileged

router = APIRouter(prefix="/queries", tags=["queries"], dependencies=[Depends(get_current_user)])


def _to_read(session: SessionDep, q: Query) -> QueryRead:
    raiser = session.get(User, q.raised_by_user_id)
    resolver = session.get(User, q.resolved_by_user_id) if q.resolved_by_user_id else None
    ticket = session.get(Ticket, q.ticket_id) if q.ticket_id else None
    return QueryRead(
        id=q.id,
        raised_by_user_id=q.raised_by_user_id,
        raised_by_name=(raiser.full_name or raiser.username) if raiser else None,
        subject=q.subject,
        message=q.message,
        ticket_id=q.ticket_id,
        ticket_no=ticket.ticket_no if ticket else None,
        status=q.status,
        reply=q.reply,
        resolved_by_name=(resolver.full_name or resolver.username) if resolver else None,
        created_at=q.created_at,
        resolved_at=q.resolved_at,
    )


@router.get("", response_model=list[QueryRead])
def list_queries(session: SessionDep, user: CurrentUser, status: QueryStatus | None = None):
    stmt = select(Query)
    # Admin/Engineer see all; everyone else only their own.
    if not is_privileged(user):
        stmt = stmt.where(Query.raised_by_user_id == user.id)
    if status:
        stmt = stmt.where(Query.status == status)
    queries = session.exec(stmt.order_by(Query.id.desc())).all()
    return [_to_read(session, q) for q in queries]


@router.post("", response_model=QueryRead, status_code=201)
def raise_query(payload: QueryCreate, session: SessionDep, user: CurrentUser):
    if not payload.subject.strip() or not payload.message.strip():
        raise HTTPException(400, "Subject and message are required")
    if payload.ticket_id and not session.get(Ticket, payload.ticket_id):
        raise HTTPException(404, "Ticket not found")

    query = Query(
        raised_by_user_id=user.id,
        subject=payload.subject.strip(),
        message=payload.message.strip(),
        ticket_id=payload.ticket_id,
        status=QueryStatus.OPEN,
    )
    session.add(query)
    session.commit()
    session.refresh(query)
    return _to_read(session, query)


@router.post("/{query_id}/resolve", response_model=QueryRead, dependencies=[Depends(require_engineer)])
def resolve_query(query_id: int, payload: QueryResolve, session: SessionDep, user: CurrentUser):
    query = session.get(Query, query_id)
    if not query:
        raise HTTPException(404, "Query not found")
    if not payload.reply.strip():
        raise HTTPException(400, "A reply is required to close the query")
    query.reply = payload.reply.strip()
    query.status = QueryStatus.CLOSED
    query.resolved_by_user_id = user.id
    query.resolved_at = date.today()
    session.add(query)
    session.commit()
    session.refresh(query)
    return _to_read(session, query)
