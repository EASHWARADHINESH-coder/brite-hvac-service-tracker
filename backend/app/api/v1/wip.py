"""WIP reports (Today / Past / Future) and the escalation list.

Read-only oversight: Service Admin, Service Engineer and Managing Director see the org-wide
picture. Task-scoped roles (Technician / Helper) are not served these aggregate views.
"""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUser, SessionDep, get_current_user
from app.services.permissions import has_org_scope
from app.services import wip as wip_service

router = APIRouter(prefix="/wip", tags=["wip"], dependencies=[Depends(get_current_user)])


def _require_org_scope(user: CurrentUser) -> None:
    if not has_org_scope(user):
        raise HTTPException(403, "Requires org-wide scope")


@router.get("/today")
def today(
    session: SessionDep,
    user: CurrentUser,
    date_: date | None = Query(None, alias="date", description="Defaults to today"),
) -> dict:
    _require_org_scope(user)
    return wip_service.today_wip(session, date_)


@router.get("/past")
def past(
    session: SessionDep,
    user: CurrentUser,
    start: date | None = Query(None, description="Defaults to 30 days ago"),
    end: date | None = Query(None, description="Defaults to today"),
) -> dict:
    _require_org_scope(user)
    end = end or date.today()
    start = start or end - timedelta(days=30)
    if start > end:
        raise HTTPException(400, "start must be on or before end")
    return wip_service.past_wip(session, start, end)


@router.get("/future")
def future(session: SessionDep, user: CurrentUser) -> dict:
    _require_org_scope(user)
    return wip_service.future_wip(session)


@router.get("/backlog-trend")
def backlog_trend(session: SessionDep, user: CurrentUser, weeks: int = 8) -> dict:
    _require_org_scope(user)
    return wip_service.backlog_trend(session, weeks=max(1, min(weeks, 26)))


@router.get("/escalations")
def escalations(session: SessionDep, user: CurrentUser) -> dict:
    _require_org_scope(user)
    return wip_service.escalations(session)


def _report_range(
    period: str, date_: date | None, start: date | None, end: date | None
) -> tuple[date, date, str]:
    """Explicit start/end wins; otherwise resolve the Daily/Weekly/Monthly preset."""
    if start and end:
        if start > end:
            raise HTTPException(400, "start must be on or before end")
        return start, end, "Custom"
    return wip_service.period_range(period, date_ or date.today())


@router.get("/report")
def report(
    session: SessionDep,
    user: CurrentUser,
    period: str = Query("daily", pattern="^(daily|weekly|monthly)$"),
    date_: date | None = Query(None, alias="date", description="Anchor date (defaults to today)"),
    start: date | None = Query(None),
    end: date | None = Query(None),
) -> dict:
    """On-screen WIP report: summary counts + ticket list + per-technician, over a period."""
    _require_org_scope(user)
    s, e, label = _report_range(period, date_, start, end)
    return wip_service.wip_report(session, s, e, label)


@router.get("/report.xlsx")
def report_xlsx(
    session: SessionDep,
    user: CurrentUser,
    period: str = Query("daily", pattern="^(daily|weekly|monthly)$"),
    date_: date | None = Query(None, alias="date"),
    start: date | None = Query(None),
    end: date | None = Query(None),
) -> StreamingResponse:
    """Excel download of the same WIP report."""
    _require_org_scope(user)
    s, e, label = _report_range(period, date_, start, end)
    data = wip_service.wip_report(session, s, e, label)
    content = wip_service.wip_report_xlsx(data)
    filename = f"wip-report-{label.lower()}-{s.isoformat()}_{e.isoformat()}.xlsx"
    return StreamingResponse(
        iter([content]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
