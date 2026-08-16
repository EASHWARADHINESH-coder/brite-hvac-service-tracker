"""Aggregate API v1 router.

Phase 1 will mount resource routers here:
    customers, team, skills, complaints, materials (catalog),
    tickets (+ lifecycle updates), pms, materials-tracker, dashboard.
Each lives in its own module as a thin handler delegating to app/services.
"""

from fastapi import APIRouter

from app.api.v1 import (
    ai,
    auth,
    claims,
    complaints,
    customers,
    dashboard,
    exports,
    material_ledger,
    materials,
    materials_tracker,
    notifications,
    payments,
    photos,
    pms,
    queries,
    reports,
    skills,
    tasks,
    team,
    tickets,
    users,
    wip,
)

api_router = APIRouter(prefix="/api/v1")


@api_router.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}


api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(customers.router)
api_router.include_router(team.router)
api_router.include_router(skills.router)
api_router.include_router(complaints.router)
api_router.include_router(materials.router)
api_router.include_router(tickets.router)
api_router.include_router(pms.router)
api_router.include_router(materials_tracker.router)
api_router.include_router(material_ledger.router)
api_router.include_router(claims.router)
api_router.include_router(dashboard.router)
api_router.include_router(exports.router)
api_router.include_router(tasks.router)
api_router.include_router(notifications.router)
api_router.include_router(payments.router)
api_router.include_router(queries.router)
api_router.include_router(reports.router)
api_router.include_router(photos.router)
api_router.include_router(ai.router)
api_router.include_router(wip.router)
