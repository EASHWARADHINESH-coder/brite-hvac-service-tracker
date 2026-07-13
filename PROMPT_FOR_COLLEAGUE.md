# Load the full data into the live app — instructions for the deploy owner

You'll receive one file separately (privately — it contains real customer data + password hashes):

```
service_tracker_prod.db
```

It's the **complete** database snapshot of the Service Tracker (179 customers, 48 tickets,
10 user accounts, PMS, materials, and the AI search index). Loading it replaces the empty
production database so the live app at **https://briteai.in/service** is fully populated.

Upload `service_tracker_prod.db` into the deployment folder on the server
(e.g. `/opt/brite-hvac-service-tracker/`), then either **paste the prompt below into Claude Code**
run from that folder, or follow the manual steps in [`LOAD_DATA_TO_PROD.md`](LOAD_DATA_TO_PROD.md).

---

## Prompt to paste into Claude Code (run from the deployment folder on the server)

> I have a SQLite database file named `service_tracker_prod.db` in this directory. It's the
> complete data snapshot for our **Service Tracker** app (FastAPI + SQLModel + **SQLite**,
> deployed with **Docker + nginx**, served at `https://briteai.in/service`). Load this data into
> the **live** deployment by replacing the app's current database with this file. Do it safely:
>
> 1. **Confirm it's SQLite first.** Find the running API container and check its `DATABASE_URL`
>    (expect `sqlite:////data/prod.db`). If it's **Postgres**, STOP and tell me — this file won't
>    apply and we'll need a Postgres dump instead.
> 2. **Discover, don't assume:** find the actual API container name and DB file path/volume from
>    `docker compose ps`, the compose file, and/or `docker inspect` — likely service `api`
>    (container `st_api`) with the DB at `/data/prod.db`, but verify.
> 3. **Back up** the current live database to a timestamped file before changing anything.
> 4. **Swap:** stop the API container → `docker cp service_tracker_prod.db <container>:/data/prod.db`
>    → delete any stale `/data/prod.db-wal` and `/data/prod.db-shm` files → start the API container.
> 5. **Verify:** `curl -s https://briteai.in/service/api/v1/health` should return `{"status":"ok"}`,
>    and the data should now be present (the file has **179 customers, 48 tickets, 227 index
>    vectors**). If the repo has `verify_prod.py`, run it with the admin password to confirm counts.
> 6. **Remind me to change the admin password** — the file includes login accounts, including a
>    default `admin` that must be secured on a public site.
>
> Show me each command before running anything destructive, and back up before the swap.

---

## Manual quick reference (if not using the prompt)
```bash
cd /opt/brite-hvac-service-tracker        # the deployment folder
docker compose -f docker-compose.prod.yml exec api printenv DATABASE_URL   # expect sqlite:////data/prod.db
docker cp st_api:/data/prod.db ./prod-backup-$(date +%F).db                # backup
docker compose -f docker-compose.prod.yml stop api
docker cp service_tracker_prod.db st_api:/data/prod.db                     # swap in
docker compose -f docker-compose.prod.yml run --rm --no-deps --entrypoint sh api -c "rm -f /data/prod.db-wal /data/prod.db-shm"
docker compose -f docker-compose.prod.yml start api
curl -s https://briteai.in/service/api/v1/health
```

## After loading
- Log in with the existing accounts (incl. `admin` / `admin123`) and **change the admin password
  immediately** — it's a public site.
- If AI is enabled on the server, optionally rebuild the search index:
  `POST https://briteai.in/service/api/v1/ai/reindex` (as an Admin/Engineer).
- If `DATABASE_URL` turned out to be Postgres, don't use this file — ask for a Postgres dump instead.
