# Service Tracker

HVAC service workflow CRM — digitizes the `SERVICE WORKFLOW` Excel into a web app. Tracks
**Breakdown, Service, Repaired Service and PMS** jobs from open → close.

**Stack:** React 18 + Vite + TypeScript + Tailwind · FastAPI + SQLModel · PostgreSQL.
Folder layout follows the `AI_FullStack_Development_Kit` conventions (thin `api/`, fat
`services/`). See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the full phased plan,
domain model and business rules.

## Quick start (Windows)

Prereqs: Python 3.12, Node LTS, Docker Desktop.

```bat
run_backend.bat     :: starts Postgres (docker) + FastAPI on http://localhost:8000
run_frontend.bat    :: starts Vite on http://localhost:5173
```

- API docs: http://localhost:8000/docs
- Health:   http://localhost:8000/api/v1/health

On first boot the backend creates the tables and seeds master data (Skills, Complaints,
Materials Database) from `app/seed.py`.

**Create the first admin** (one-off), then log in at the UI:

```bat
cd backend
python -m app.create_admin <username> <password> "Full Name"
```

## Structure

```
backend/app/   api/v1· core· models· schemas· services· database.py· seed.py· main.py
frontend/src/  components/{ui,layout,forms,features}· pages· hooks· context· api· types· utils
docker-compose.yml   Postgres
```

## API (Phase 1)

All under `/api/v1`. Interactive docs at `/docs`.

All endpoints except `auth/login` require a Bearer token. Roles: **Service Admin** (everything),
**Service Engineer** (all tickets/PMS/materials ops), **Task Manager** (edit only their own tasks +
record material usage), **Helper** (view only their own tasks).

| Resource            | Endpoints                                                              |
| ------------------- | --------------------------------------------------------------------- |
| `auth`              | `login` (JSON) · `me`                                                  |
| `users`             | list · create · update · `{id}/deactivate` — **Service Admin only**    |
| `customers`         | list (`?q=`) · create · get · update · delete                         |
| `team`              | list · create · get · update · delete                                 |
| `skills`            | list · create · delete                                                |
| `complaints`        | list · create · delete                                                |
| `materials`         | list · create · delete (catalog / Materials Database)                 |
| `tickets`           | list (`?status=&work_type=&customer_id=&q=`) · create · get           |
| `tickets/{id}/updates` | list · add (lifecycle stage; recomputes status, links team)        |
| `pms`               | list · create (auto-dates) · get · `{id}/regenerate`                  |
| `materials-tracker` | list (`?ticket_id=`) · create · update · delete                       |
| `materials-ledger`  | `stock` · `inward` (list/create) · `issues` (list/allocate) · `issues/{id}/deliver` |
| `dashboard/summary` | counts by status / work type / customers                              |
| `ai`                | `status` · `rank-tickets` (Engineer+) · `tickets/{id}/delivery-note` (Engineer+) · `assistant` · `assistant/stream` (SSE agent) · `actions/execute` (Engineer+) |

Smoke test: `backend/.venv/Scripts/python smoke_test.py` (SQLite, no Postgres needed) — exercises
ticket numbering, skill derivation, full lifecycle, reopen, PMS auto-dates, and the dashboard.

## Frontend (Phase 2)

React Router app under `frontend/src`:

- **Dashboard** — ticket counts by status + work type
- **Tickets** — list with status/work-type/search filters
- **Ticket detail** — metadata + lifecycle timeline + add-update form (stage, team multi-select, reopen)
- **Create Ticket** — with live derived-skill preview
- **PMS** — work orders with auto-generated visit dates
- **Materials** — tabs: Stock (live availability), Inward, Issues (allocate → delivery note / return), Catalog, Tracker
- **Customers** — CRUD + search

Dev server proxies `/api` to the backend (target overridable via `VITE_API_PROXY`).

## Status

- **Phase 0 — scaffold:** done.
- **Phase 1 — core CRM API:** done (verified by `smoke_test.py`).
- **Phase 2 — React frontend:** done. Builds clean under TS strict; verified running against the
  live API (Dashboard, Tickets list, and the reopen lifecycle timeline render with seeded data).
- **Phase 3 — materials ledger:** done. Inward → allocate → delivery note / return with global
  stock (`received − consumed`). Verified by `smoke_test_ledger.py` and live UI.
- **Phase 4 — auth & roles:** done. JWT login, 4 roles (Service Admin / Service Engineer /
  Task Manager / Helper), User↔Team link, task-scoped access, route guards + role-filtered UI.
  Verified by `smoke_test_auth.py` and live login flow.
- **Phase 5 — AI layer:** built. Ticket-allocation ranking, delivery-note drafting, a
  scope-aware assistant, and a **LangGraph tool-using agent** with token streaming (SSE) and
  guarded write actions (the agent can only *propose* a ticket; the user confirms, the server
  executes via the same logic as the REST API). All **fallback-first** — everything runs on
  deterministic logic with the LLM off. **Free provider, pick one:** `AI_PROVIDER=groq` (cloud
  free tier, needs a free key) or `AI_PROVIDER=ollama` (fully local/offline, no key). Enable
  with `AI_ENABLED=true` and `pip install -r requirements.txt`. Deterministic + fallback paths
  and the guarded write path verified with the LLM off. Frontend **Assistant** page streams
  tokens and surfaces a Confirm button for proposed actions. Remaining (Phase 6): Docker deploy.
  See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
