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

## Later: attach a domain + HTTPS
When you have a domain:
1. Point an **A record** at `VPS_IP`.
2. Add TLS (Let's Encrypt via a companion container or certbot) and open port 443.

Ping me when you're ready and I'll add the HTTPS config.

## Later: Step 6 — turn on the AI layer
Set `AI_ENABLED=true` in `backend/.env.prod` and either add a free `GROQ_API_KEY`
(`AI_PROVIDER=groq`) or run Ollama on a larger VPS (`AI_PROVIDER=ollama`), then
`docker compose -f docker-compose.prod.yml up -d`.
