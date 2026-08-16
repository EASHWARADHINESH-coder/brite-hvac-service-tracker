# Load the working dataset into the live deployment (briteai.in/service)

Goal: replace the empty production database with an exact copy of the local working data
(179 customers, 48 tickets, lifecycle history, RAG index). The live app is the current `main`
codebase on SQLite, so a **file swap** replicates everything exactly.

**Hand this file to whoever controls the server.** You'll also receive `service_tracker_prod.db`
(the DB snapshot) out-of-band — it contains real customer data + user password hashes, so send it
over a private channel, not a public one.

---

## Prerequisites
- The snapshot file `service_tracker_prod.db` (from the app author).
- Shell access to the server + the running deployment (Docker).
- Confirm the app stores its DB in SQLite (our default). Check the API's DB URL:
  ```bash
  docker compose -f docker-compose.prod.yml exec api printenv DATABASE_URL
  # expect: sqlite:////data/prod.db   (file /data/prod.db inside the st_data volume)
  ```
  If it points at Postgres instead, stop — a SQLite file can't be dropped in; ask for a
  Postgres dump path instead. If the container/volume/path differ from below, adjust accordingly.

## Steps (adjust container name / compose file to your setup)
```bash
cd /opt/brite-hvac-service-tracker      # wherever the repo/compose lives on the server

# 1. Upload service_tracker_prod.db here (scp / Hostinger file manager), then:

# 2. Back up the current (empty) prod DB — just in case
docker cp st_api:/data/prod.db ./prod-backup-$(date +%F).db 2>/dev/null || echo "no existing db"

# 3. Stop the API so nothing writes during the swap
docker compose -f docker-compose.prod.yml stop api

# 4. Copy the snapshot in as prod.db, and delete any stale WAL sidecars from the OLD db
docker cp service_tracker_prod.db st_api:/data/prod.db
docker compose -f docker-compose.prod.yml run --rm --no-deps --entrypoint sh api \
  -c "rm -f /data/prod.db-wal /data/prod.db-shm"

# 5. Start the API again
docker compose -f docker-compose.prod.yml start api

# 6. Verify
curl -s https://briteai.in/service/api/v1/health      # {"status":"ok"}
```
On startup the app runs `create_all` (no-op, tables already exist) and seeds masters
(idempotent). Then open **https://briteai.in/service** — the customers and tickets appear.

## After loading — two must-dos
1. **Security — change the admin password.** The snapshot carries the local accounts, including
   the default **`admin` / `admin123`**. On a public site that must change immediately: log in,
   go to **Users**, reset the admin password (and remove/disable any stray test accounts), or
   create a fresh admin and deactivate the old one:
   ```bash
   docker compose -f docker-compose.prod.yml exec api python -m app.create_admin <user> '<strong-pass>' 'Admin'
   ```
2. **AI / RAG index (only if AI is enabled on the server).** The vector index copies with the
   file, but it's safe to rebuild after import:
   `POST https://briteai.in/service/api/v1/ai/reindex` (as an Engineer/Admin). If AI is off in
   prod, skip — search falls back to non-semantic matching.

## Notes
- This is a full replace, not a merge: any records already created in prod are overwritten by the
  snapshot. (Prod was empty, so nothing is lost — the backup in step 2 covers you regardless.)
- To refresh prod again later with newer local data, repeat with a fresh snapshot.
- **Opposite direction** (pull live data down to local): see
  [`PULL_FROM_LIVE.md`](PULL_FROM_LIVE.md), which uses `backend/pull_from_live.py`.
