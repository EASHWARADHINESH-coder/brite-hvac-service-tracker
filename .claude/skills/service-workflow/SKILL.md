---
name: service-workflow
description: End-to-end operational playbook for the Service Tracker — an HVAC service-workflow CRM (React + FastAPI + SQLite) that digitizes the SERVICE WORKFLOW Excel. Use whenever working on this project: breakdown/service/repaired-service/PMS tickets, the ticket lifecycle, materials ledger + Blue Star (BSL) claims, payments, PMS scheduling, the monthly Excel importers, the AI layer (Groq/Ollama + RAG), running the app, or deploying it. Trigger on "service workflow", "ticket", "breakdown", "PMS", "materials/claim", the Excel workbook, or the /service-workflow command.
---

# Service Tracker — end-to-end workflow

HVAC service-business CRM digitizing the `SERVICE WORKFLOW` Excel into a multi-user web app.
Tracks **Breakdown, Service, Repaired Service, PMS** jobs from open → close, plus materials,
Blue Star warranty claims, payments, and a production AI layer.

- **Repo:** https://github.com/EASHWARADHINESH-coder/brite-hvac-service-tracker (private)
- **Stack:** React 18 + Vite + TS + Tailwind · FastAPI + SQLModel (Pydantic v2) · SQLite (dev/prod) / Postgres (optional) · JWT auth · LangGraph + Groq/Ollama + sqlite-vec (AI)
- **Layout:** thin `backend/app/api/v1/` handlers → fat `backend/app/services/`; feature-based React `frontend/src/`.

## Run the stack (Windows, local)
```bat
:: backend (SQLite, no Docker needed) — from backend/
.venv\Scripts\python -m uvicorn app.main:app --port 8000 --host 127.0.0.1
:: frontend — from frontend/
npm run dev          :: http://localhost:5173  (proxies /api -> :8000)
```
- API docs `http://localhost:8000/docs` · health `/api/v1/health`
- First admin: `python -m app.create_admin <user> <pass> "Full Name"`
- On boot the app creates tables + seeds master data (30 skills, 18 complaints, 7 materials).
- Smoke tests (SQLite, no server): `python smoke_test.py`, `smoke_test_ledger.py`, `smoke_test_auth.py`.

## Core business rules (must stay consistent everywhere — `services/ticket_logic.py`)
1. **Work-type prefix:** Breakdown=`B`, Service=`S`, Repaired Service=`R`, PMS=`P`.
2. **Machine types:** VRF, Ductable, Package, Chiller, Split, Cassette, AHU.
3. **Ticket number:** `PREFIX + YYYYMMDD + 2-digit running no.`, e.g. `B2026061301`. The running
   number is **continuous across all work types for that calendar date** (not per prefix).
4. **Skill derivation:** `"<Complaint Type> - <Machine Type>"` (e.g. `Major Breakdown - VRF`).
   Complaint Type comes from the Complaint master.
5. **Status auto-rule:** end date present ⇒ `Closed`; else `Open`; `In Progress` once work started;
   `Reopened` when a closed issue recurs (same ticket, new lifecycle rows, `reopen=True`).
6. **Lifecycle stages:** `Logged → Assigned → Work Started → (Material Pending) →
   (Testing & Commissioning) → Closed` (+ Reopened). One Ticket → many TicketUpdate rows.
7. **Team:** Job Lead = single; Team = multi. Types: Technician, Helper, Contractor.
8. **Assignment SLA:** a Logged ticket unassigned past **72h** is flagged overdue.

## Roles (JWT — `services/permissions.py`)
- **Service Admin** — everything (users, masters, deletes).
- **Service Engineer** — all tickets/PMS/materials ops.
- **Technician** — job lead; edits only their own tickets/tasks.
- **Helper** — view only their own tasks.
Task-scoped roles see only tickets where their linked TeamMember is Job Lead or on a lifecycle update.

## Operational workflows
- **Ticket:** create (`POST /tickets` → auto number+skill+Logged row) → add lifecycle updates
  (`POST /tickets/{id}/updates`: stage, team, dates) → status recomputed → close on end date.
- **Materials ledger** (`materials_ledger.py`): `INWARD` → `ALLOCATE` to ticket → `DELIVERY NOTE`
  (Used) or `Not Used` (return). Stock = received − consumed. Numbering `IN/ISS/DN + date + nn`.
- **Blue Star (BSL) claims** (`material_claim.py`): AMC warranty replacement lifecycle —
  MR Raised → Material Received / Awaiting Replenish → Replaced → Defective → Dispatched.
  A ticket cannot close while it has an unresolved BSL claim.
- **Payments** (`payment.py`): Repaired Service requires a total; advances + payments tracked;
  balance drives the payment-follow-up dashboard.
- **PMS** (`pms_schedule.py`): per-customer Work Order + schedule frequency auto-generates visit
  dates; due visits become PMS tickets via `POST /pms/auto-generate` (idempotent).

## Monthly Excel import (`services/imports.py`)
Idempotent, re-runnable importers for the monthly workbook:
```bat
python -m app.import_pms       "<file>.xlsx"   :: customers only, deduped by CRM Customer Id
python -m app.import_breakdown "<file>.xlsx"   :: Breakdown tickets; auto-close on Closing Date
```
- PMS sheet → Customer master (name/address/city/pincode/phone + `crm_customer_id`); no WO/contract.
- Breakdown sheet → tickets; maps sheet complaints to the master (e.g. EXV Replace→EXP Valve
  Problem, IVRF→VRF); sets the listed technician as Job Lead; never opens a 2nd ticket for a
  customer that already has an open one.
- Blue Star MR sheet → the claim flow already exists; not bulk-imported.

## AI layer (Phase 5–6 — `services/ai/`, endpoints under `/api/v1/ai`)
**Fallback-first:** every feature has a deterministic implementation; the LLM only enhances when
`AI_ENABLED=true`. Config in `backend/.env` (see `.env.example`).

- **Providers / failover:** local **Ollama** (default, free) or **Groq** (cloud free tier), via a
  LangChain adapter (`llm.py`). Multi-model local **failover chain**
  `llama3.2:3b → qwen2.5:3b → gemma2:2b` (`OLLAMA_FALLBACK_MODELS`), unavailable models skipped;
  `AI_CLOUD_FAILOVER` optionally ends at Groq.
- **Assistant:** deterministic intent routing + LLM; scope-aware. `POST /ai/assistant` and SSE
  `POST /ai/assistant/stream` (LangGraph ReAct agent + guarded write actions via
  `POST /ai/actions/execute`).
- **RAG / semantic search:** `sqlite-vec` + Ollama embeddings (`nomic-embed-text`) over tickets &
  customers. `GET /ai/search`, `GET /ai/tickets/{id}/similar`, agent `find_similar_tickets` tool,
  and grounded assistant answers. Build the index: `POST /ai/reindex` (async job → `/ai/jobs/{id}`).
- **8 production principles:** caching (`cache.py`), monitoring (`/ai/metrics`), reliability
  (circuit breaker + retries + SQLite WAL), security (prompt-injection guard + rate limiting),
  async queues (`jobs.py`), provider/model failover, gateway (`/ai` router), model serving
  (`/ai/health`). The frontend **Assistant** page has an AI status panel (model chain + metrics).
- Enable AI: set `AI_ENABLED=true`, `AI_PROVIDER=ollama`, `pip install -r requirements.txt`,
  `ollama pull llama3.2:3b nomic-embed-text` (+ fallbacks), then `POST /ai/reindex`.

## Deployment (Hostinger VPS — Docker + SQLite)
See `DEPLOY.md`. `docker-compose.prod.yml` runs `api` (uvicorn) + `web` (nginx serves the SPA and
proxies `/api`); SQLite on a persistent volume. Ships `AI_ENABLED=false` by default (flip on with a
provider + reindex). Real secrets live in `backend/.env.prod` (gitignored); template is `.env.prod.example`.
Update flow: `git pull && docker compose -f docker-compose.prod.yml up -d --build`.

## Key files
- Business logic: `backend/app/services/{ticket_logic,materials_ledger,material_claim,pms_schedule,permissions,imports}.py`
- AI: `backend/app/services/ai/{llm,agent,tools,rag,embeddings,vectorstore,cache,metrics,reliability,security,jobs}.py`
- API: `backend/app/api/v1/*.py` · models `backend/app/models/*.py` · enums `backend/app/core/enums.py`
- Frontend: `frontend/src/pages/*.tsx`, `components/`, `api/services.ts`, `types/index.ts`
- Docs: `README.md`, `IMPLEMENTATION_PLAN.md`, `DEPLOY.md`

## Conventions when extending
- Thin API handlers; put logic in `services/`. Match existing module style/comment density.
- New SQLModel tables must be imported in `app/models/__init__.py` (registers on metadata).
- AI additions stay fallback-first: deterministic path always works; LLM is additive; never let an
  LLM/embedding failure raise into a request handler (return None → deterministic result).
- Importers and reindex must stay idempotent (upsert/skip, never duplicate).
