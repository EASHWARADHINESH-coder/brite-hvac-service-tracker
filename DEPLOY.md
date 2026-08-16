# Production Deployment — Hostinger VPS

Deploys the Service Tracker to a single Hostinger VPS with Docker: FastAPI backend + nginx-served
React frontend + SQLite, reachable on the VPS IP over HTTP. AI is off in this deploy (Step 6).

**Architecture:** browser → `web` (nginx :80, serves the SPA and proxies `/api` → `api:8000`) →
`api` (uvicorn) → SQLite file on a persistent Docker volume.

> You run these steps on the server; nothing here needs access to your local machine. Replace
> `VPS_IP` and the placeholder credentials with your own.

---

## 1. Provision the VPS
- Hostinger → **VPS** → an Ubuntu 22.04/24.04 template. Note the **IP address** and root password.
- In the Hostinger panel (or `ufw`), make sure **port 80** is open.

## 2. SSH in and install Docker
```bash
ssh root@VPS_IP

# Docker Engine + compose plugin (official convenience script)
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

## 3. Get the code onto the server
The repo is **private**, so cloning needs auth. Easiest one-off: a Personal Access Token
(the same kind you made earlier) used inline for a read-only clone.
```bash
cd /opt
git clone https://<YOUR_GITHUB_PAT>@github.com/EASHWARADHINESH-coder/brite-hvac-service-tracker.git
cd brite-hvac-service-tracker
```
*(Alternative: add a read-only **deploy key** to the repo and clone over SSH — ask me and I'll walk you through it.)*

## 4. Configure production env
```bash
cp backend/.env.prod.example backend/.env.prod
# set a strong secret:
sed -i "s/CHANGE_ME_use_a_long_random_string/$(openssl rand -hex 32)/" backend/.env.prod
nano backend/.env.prod     # review; keep AI_ENABLED=false for now
```

## 5. Build and start
```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps      # both api + web should be "running"
```
On first boot the API creates the tables and seeds master data (skills / complaints / materials).

## 6. Create the first admin
```bash
docker compose -f docker-compose.prod.yml exec api \
  python -m app.create_admin admin 'a-strong-password' 'Administrator'
```

## 7. Import your real data
Copy the monthly workbook to the server, then into the `api` container, then run the importers:
```bash
# from your local machine (one line), or use Hostinger's file manager:
scp "Jul 2026 PMS Schedule as on 09.07.2026.xlsx" root@VPS_IP:/opt/brite-hvac-service-tracker/

# on the server:
docker compose -f docker-compose.prod.yml cp \
  "Jul 2026 PMS Schedule as on 09.07.2026.xlsx" api:/tmp/data.xlsx

docker compose -f docker-compose.prod.yml exec api python -m app.import_pms       /tmp/data.xlsx
docker compose -f docker-compose.prod.yml exec api python -m app.import_breakdown /tmp/data.xlsx
```
*(Both importers are idempotent — safe to re-run each month with the new file.)*

## 8. Open the app
Visit **http://VPS_IP** and log in with the admin account from step 6.

---

## Everyday operations

**Update to the latest code**
```bash
cd /opt/brite-hvac-service-tracker
git pull
docker compose -f docker-compose.prod.yml up -d --build
```
> ⚠️ **Some updates add DB columns.** SQLModel's `create_all` (run on boot) creates *new*
> tables but **never ALTERs existing ones**, so new columns on `ticket` / `payment` /
> `ticket_report` must be added by hand once. Take a backup first, then run the migration block
> below (it's idempotent — safe to re-run, skips columns that already exist). See
> [Schema migrations](#schema-migrations).

**Back up the database** (single SQLite file on the volume)
```bash
docker compose -f docker-compose.prod.yml cp api:/data/prod.db "./backup-$(date +%F).db"
```

**Logs**
```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f web
```

---

## Schema migrations

New columns on existing tables must be added manually after a `git pull` that introduces them
(SQLModel only auto-creates brand-new tables, never new columns on existing ones). **Always back
up first** (see above), then run the block below against the container's `prod.db`. It is
**idempotent** — it inspects each table and adds only the columns that are missing, so it's safe
to run on every update regardless of which release the DB is already on. Restart the API after.

```bash
docker compose -f docker-compose.prod.yml exec api python - <<'PY'
import sqlite3
db = sqlite3.connect("/data/prod.db"); cur = db.cursor()
# (table, column, "TYPE [constraints]")
wanted = [
    ("ticket",        "cancel_reason",         "VARCHAR"),
    ("ticket",        "bill_no",               "VARCHAR"),
    ("ticket",        "bill_date",             "DATE"),
    ("ticket",        "bill_remarks",          "VARCHAR"),
    ("ticket",        "commissioning_status",  "VARCHAR"),
    ("ticket",        "commissioning_remarks", "VARCHAR"),
    ("ticket",        "starred",               "BOOLEAN NOT NULL DEFAULT 0"),
    ("payment",       "is_correction",         "BOOLEAN NOT NULL DEFAULT 0"),
    ("ticket_report", "category",              "VARCHAR NOT NULL DEFAULT 'general'"),
    ("customer",      "key_account",           "BOOLEAN NOT NULL DEFAULT 0"),
]
for table, col, decl in wanted:
    cols = [r[1] for r in cur.execute(f"PRAGMA table_info({table})").fetchall()]
    if col in cols:
        print(f"skip  {table}.{col} (exists)")
    else:
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
        print(f"added {table}.{col}")
db.commit(); db.close()
PY

docker compose -f docker-compose.prod.yml restart api
```

**Notes**
- The `ticket_edit` table (edit/cancel/billing/commissioning audit notes) is created
  automatically by `create_all` on boot — no ALTER needed; just confirm it exists afterward.
- The `Cancelled` value on the ticket-status enum is application-level (no schema change).
- **What each column powers** — `ticket.cancel_reason`: ticket cancellation (Discussion 7 #1);
  `ticket.bill_no/bill_date/bill_remarks`: manual billing (#6); `ticket.commissioning_status/
  commissioning_remarks`: installation report (#4); `payment.is_correction`: signed ledger
  corrections (#3); `ticket_report.category`: separates commissioning PDFs from general ones (#4).
- **Discussion 8** adds `ticket.starred` (manual "important" flag) and `customer.key_account`
  (key/VIP boost) — both feed the dashboard priority list. The WIP report (#2) and the priority
  ranking are query-only otherwise.

---

## Later: attach a domain + HTTPS
When you have a domain:
1. Point an **A record** at `VPS_IP`.
2. Add TLS (Let's Encrypt via a companion container or certbot) and open port 443.

Ping me when you're ready and I'll add the HTTPS config.

## Turn on the AI layer — zero API cost

The compose file already runs an `ollama` service and pulls the embedder on first boot, so this
needs no host setup and **no API keys, no money**.

### Recommended: search-only (fully free AND fully private)
Turns on **semantic search + "similar tickets"** using the local embedder. No chat model, so the
assistant falls back to deterministic answers — nothing ever leaves the server, and it needs only
~1 GB RAM. This is the default in `backend/.env.prod.example`:
1. In `backend/.env.prod`: `AI_ENABLED=true`, `AI_PROVIDER=ollama` (no `GROQ_API_KEY` needed).
2. `docker compose -f docker-compose.prod.yml up -d --build` — the `ollama-pull` step downloads
   `nomic-embed-text` (~274 MB) once. Watch: `docker compose -f docker-compose.prod.yml logs -f ollama-pull`.
3. Build the index once (as Admin/Engineer): `POST https://briteai.in/service/api/v1/ai/reindex`.
   Check it: `GET .../api/v1/ai/health` should show `indexed_documents > 0` and `vector_store: true`.

### Add the AI assistant later (optional — still $0, pick by VPS RAM)
The assistant only writes the *wording*; the facts come from deterministic tools + RAG either way.
- **Fully local + private** (VPS with ~4 GB+ free RAM; slower on CPU): keep `AI_PROVIDER=ollama`,
  set `OLLAMA_MODEL=llama3.2:3b` (or `gemma2:2b` on a smaller box), and add
  `ollama pull llama3.2:3b` to the `ollama-pull` step in `docker-compose.prod.yml`.
- **Free + fast, no server RAM** (small VPS): `AI_PROVIDER=groq` + a free key from
  <https://console.groq.com/keys>. Free in money; the prompt (incl. the grounding facts) is sent
  to Groq, so it's not as private as the local option.

Notes: `OLLAMA_BASE_URL` is set to `http://ollama:11434` by the compose file — don't point it at
`127.0.0.1`. Everything degrades gracefully: if the LLM/embedder is down, features fall back to
deterministic logic (the app never errors because of AI).
