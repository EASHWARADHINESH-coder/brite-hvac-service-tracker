# Pull the live dataset down to local (briteai.in/service -> your machine)

Goal: copy the **live production data** down into your local dev database, so you can keep
building and testing against real customers/tickets. This is the mirror of
[`LOAD_DATA_TO_PROD.md`](LOAD_DATA_TO_PROD.md) (which pushes local -> live).

The whole app is SQLite, so a **file swap** replicates everything exactly: customers, tickets,
lifecycle history, users (with password hashes), materials ledger, claims, payments, and the
AI/RAG index. There is nothing to "scrape" from the website — the data lives in one file behind
the login (`/data/prod.db` inside the `st_api` container).

> ⚠️ This **replaces** your local `dev.db`. The helper script backs it up first, and you can roll
> back any time, but be aware your current local data is set aside when you do this.

---

## Part A — On the VPS: make a snapshot and download it

You need SSH access to the VPS. Enter your own server credentials — that part can't be
automated for you.

```bash
# 1. SSH into the VPS, cd to wherever the compose file lives, then confirm it's SQLite:
docker compose -f docker-compose.prod.yml exec api printenv DATABASE_URL
#    expect: sqlite:////data/prod.db
#    If it points at Postgres instead, stop — a file swap won't work; take a pg_dump instead.

# 2. Make a CONSISTENT snapshot. A live SQLite DB has a WAL sidecar, so use .backup
#    (copying the raw file while the app runs can capture a torn state):
docker compose -f docker-compose.prod.yml exec api \
  python -c "import sqlite3; sqlite3.connect('/data/prod.db').backup(sqlite3.connect('/data/live-snapshot.db'))"

# 3. Copy it out of the container onto the VPS host:
docker cp st_api:/data/live-snapshot.db ./live-snapshot.db
```

Then, **from your local machine** (PowerShell or Git Bash), download it into `backend/`:

```bash
scp YOUR_VPS_USER@briteai.in:~/live-snapshot.db \
  "D:/Software Development/01_Service_Tracker - AI Trial/01_Service_Tracker/backend/live-snapshot.db"
```

*If SSH keys aren't set up, `scp` prompts for your VPS password — you type it. Hostinger's file
manager is a fallback for the download step if `scp` is awkward.*

The file contains real customer data and password hashes — send/store it over a private channel,
never a public one.

---

## Part B — Locally: swap it in with the helper script

From the `backend/` folder, with the venv active. **Stop the backend first** — Windows locks the
open `dev.db`, and the script will refuse to run until you do (it fails fast with a clear message
rather than leaving a half-done swap).

```bash
# 1. Stop the running backend (Ctrl-C in its terminal).

# 2. Inspect the snapshot without changing anything (optional but recommended):
python pull_from_live.py --dry-run

# 3. Do the swap — backs up dev.db, swaps the snapshot in, clears WAL sidecars, verifies:
python pull_from_live.py

# 4. Restart the backend so it opens the new file:
#    (from the repo root)  run_backend.bat     — or —
#    uvicorn app.main:app --reload --port 8000
```

What the script prints on success:

```
OK  Backed up current dev.db -> dev-backup-<timestamp>.db
OK  Swapped live-snapshot.db in as dev.db
  dev.db now: <N> customers | <N> tickets | <N> lifecycle rows | <N> users
```

### Options
| Command | What it does |
|---|---|
| `python pull_from_live.py` | Swap in `./live-snapshot.db` (the default name) |
| `python pull_from_live.py other.db` | Swap in a differently-named download |
| `python pull_from_live.py --dry-run` | Inspect the snapshot, change nothing |
| `python pull_from_live.py --restore` | Roll `dev.db` back to the newest backup |
| `python pull_from_live.py --force` | Allow an empty snapshot (normally refused) |

The script validates the file is a real Service Tracker SQLite DB before touching anything, so a
half-finished download or a saved HTML error page is caught rather than swapped in.

---

## After loading — two things to know

1. **Your local logins are now the LIVE accounts.** The snapshot carries the live users and their
   password hashes, so log in locally with a live-site username/password. Make sure you know the
   live `admin` password before relying on it. (Local-only test accounts you had are gone with the
   swap — recreate with `python -m app.create_admin <user> <pass> "Name"` if needed.)

2. **Rebuild the AI index (if AI is enabled locally).** The vector index copies with the file, but
   rebuild it so semantic search matches the pulled data:
   `POST http://127.0.0.1:8000/api/v1/ai/reindex` (as an Engineer/Admin). If AI is off locally,
   skip — search falls back to non-semantic matching.

---

## Notes
- **Full replace, not a merge.** Anything currently in your local `dev.db` is set aside (backed up),
  not merged. To go back, `python pull_from_live.py --restore`.
- **Refresh again later** by downloading a newer snapshot and re-running — each swap makes its own
  timestamped backup, so you can always step back.
- **Direction reminder:** this pulls live -> local. To push local -> live, use
  [`LOAD_DATA_TO_PROD.md`](LOAD_DATA_TO_PROD.md).
