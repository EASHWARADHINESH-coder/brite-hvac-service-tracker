# Service Tracker — Implementation Plan

HVAC service business CRM that digitizes the `SERVICE WORKFLOW` Excel workbook into a multi-user
web application. Tracks **Breakdown, Service, Repaired Service and PMS** jobs from open → close.

## Tech stack (confirmed)

| Layer          | Technology                                              |
| -------------- | ------------------------------------------------------- |
| Frontend       | React 18 + Vite + TypeScript + TailwindCSS              |
| Backend        | FastAPI + SQLModel (Pydantic v2)                        |
| Database       | PostgreSQL                                              |
| Auth           | JWT (added in Phase 4)                                  |
| AI layer       | Deferred — Groq + LangGraph in a later phase            |
| Infra          | Docker Compose (Postgres), Nginx (prod) — later phase   |

Folder structure mirrors `AI_FullStack_Development_Kit` conventions: thin route handlers in
`api/`, fat business logic in `services/`; feature-based React `components/`.

## Repository layout

```
01_Service_Tracker/
├── backend/
│   ├── app/
│   │   ├── api/v1/            # Route handlers (thin) — one module per resource
│   │   ├── core/             # config, security, exceptions
│   │   ├── models/           # SQLModel tables (masters, tickets, pms, materials)
│   │   ├── schemas/          # Pydantic request/response models
│   │   ├── services/         # Business logic (ticket numbering, status, skill derivation)
│   │   ├── database.py       # Engine + session
│   │   ├── seed.py           # Seed master data from the Excel
│   │   └── main.py           # FastAPI app factory
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   └── src/
│       ├── components/{ui,layout,forms,features}/
│       ├── pages/            # Dashboard, Customers, CreateTicket, Tickets, Materials, PMS
│       ├── hooks/  context/  api/  types/  utils/
├── nginx/                    # reverse proxy config (prod phase)
├── tests/                    # backend + frontend tests
├── .claude/  PRPs/  agents/  skills/   # context-engineering kit folders
├── docker-compose.yml        # Postgres (+ later: api, web, nginx)
└── README.md
```

## Domain model (from the Excel)

**Master data:** Customer, Team, Skill, Complaint, MaterialItem (Materials Database).
**Transactions:** Ticket, TicketUpdate (the "Ticket Database" lifecycle rows), Task, PMS,
MaterialsTracker.

### Core business rules (must stay consistent everywhere)

1. **Work types & prefix:** Breakdown=`B`, Service=`S`, Repaired Service=`R`, PMS=`P`.
2. **Machine types:** VRF, Ductable, Package, Chiller, Split, Cassette, AHU.
3. **Ticket number:** `PREFIX + YYYYMMDD + 2-digit running no.`, e.g. `B2026061301`.
   The running number is **continuous across all work types for that calendar date**
   (B…01, P…02, R…03, … not per-prefix).
4. **Skill derivation:** `"<Complaint Type> - <Machine Type>"`, e.g. Compressor failure
   (Complaint Type = *Major Breakdown*) on VRF → `Major Breakdown - VRF`. Complaint Type comes
   from the Complaint master.
5. **Status:** `Open → In Progress → Closed`, plus `Reopened`. Auto-rule from Excel: Status =
   `Closed` when an End Date is present, else `Open`. `Reopened` when a closed issue recurs
   (e.g. Sundaram Industries — closed, reopened "Again Gas Leakage", closed again).
6. **Ticket lifecycle:** one ticket → many `TicketUpdate` rows (stages):
   `Logged → Assigned → Diagnosed → Parts Requested → Repair In Progress →
    Testing & Commissioning → Closed` (+ Reopened).
7. **Team selection:** Job Lead = single select; Team = multiple select. Team types:
   Technician, Helper, Contractor.

### Materials flow

`INWARD` (BSL Sales Order | BSL Material Request | Supplier) → `ALLOCATE` to ticket + customer/site
→ `DELIVERY NOTE` (Used) or `Not Used` (returned to stock) → `CLOSED`.
Stock available = received − consumed (Returned/Not-Used adds back).
Numbering: `IN/ISS/DN + YYYYMMDD + nn`. Implemented in Phase 3 (global/single-warehouse stock).
The Excel's simpler "Materials Tracker" (requested vs received qty per ticket) is also kept.

### PMS (preventive maintenance)

Per customer Work Order: WO Number, WO Start/End, a Schedule frequency (e.g. "2 Months
Once/Year", "3 Months Once/Year") and up to 6 scheduled visit dates (Schedule 1–6).

## Delivery phases

- **Phase 0 — Scaffold (this commit):** folder tree, SQLModel schema, seed data, config, plan,
  `main.py` that creates tables + runs seed. Stubbed API routers + frontend shell. ← *confirm here*
- **Phase 1 — Core CRM API:** CRUD for masters; Ticket create with auto ticket-number + skill +
  status; TicketUpdate lifecycle endpoints; list/filter/search.
- **Phase 2 — Frontend:** Dashboard, Customers, Create Ticket, Tickets (with lifecycle timeline),
  PMS, Materials pages wired to the API.
- **Phase 3 — Materials management:** inward → allocate → delivery note ledger + stock view.
- **Phase 4 — Auth & multi-user (done):** JWT login; 4 roles — **Service Admin** (everything),
  **Service Engineer** (all tickets/PMS/materials ops), **Task Manager** (edit only their own tasks +
  material usage), **Helper** (view only their own tasks). Login users link to a Team member so
  "their tasks" = Job Lead OR team member on a lifecycle update. Contractors don't log in. First
  admin via `python -m app.create_admin`.
- **Phase 5 — AI layer (built):** auto-allocate ticket ranking, delivery-note drafting, a
  scope-aware assistant, and a LangGraph ReAct agent with SSE token streaming + guarded write
  actions. Fallback-first: every feature has a deterministic implementation in `services/ai/`
  and uses the LLM only when `AI_ENABLED=true` + a provider is configured. **Provider-agnostic
  (both free):** `AI_PROVIDER=groq` (cloud free tier) or `ollama` (local/offline), selected at
  runtime via a LangChain chat-model adapter in `services/ai/llm.py`. The agent's tools are
  read-only except `propose_create_ticket`, which records a proposal; execution is a separate
  confirmed step (`services/ai/actions.py`) that reuses the REST create-ticket logic and
  re-checks permissions — the LLM never writes directly. Endpoints under `/api/v1/ai`
  (`assistant/stream`, `actions/execute`); frontend **Assistant** page streams tokens and shows
  a Confirm button. Verified with the LLM off (deterministic + fallback + guarded-write paths).
- **Phase 6 — Deploy:** Docker Compose (api + web + postgres + nginx).

## Seed data (from the Excel masters)

- **Skills:** 30 predefined (`Major Breakdown - *`, `Commissioning - *`, `Minor Breakdown - *`,
  `General Service - *`, Welding, Bearing Replacement).
- **Complaints:** 18, each tagged with Complaint Type (Major Breakdown / Minor Breakdown /
  Commissioning).
- **Materials Database:** N2 Cylinder, O2 Cylinder, R410A Gas, R22 Gas, VRF Outdoor 10HP/14HP Fan
  Board, VRF 10HP Compressor Drive.
- **Machine types, Work types, Team types:** enumerations above.
- **Sample tickets:** the Excel's worked examples (Shenbagam Diabetics, Theni Anantham Silks,
  Sundaram Industries) load as demo data in dev only.

## Resolved decisions

1. **Tenancy:** Single HVAC company (one org). No tenant column; can layer in later if it goes SaaS.
2. **Reopen:** Same ticket number, new `TicketUpdate` lifecycle rows (matches the Excel). The
   reopen is a new chain under the existing `Ticket`, flagged `reopen=True` with a `reopen_reason`.
3. **PMS scheduling:** **Auto-generate** the 6 visit dates from WO start date + schedule frequency
   (e.g. every 2 / 3 months), editable afterward. Phase 1 adds a `pms_schedule` service.
