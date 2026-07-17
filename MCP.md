# Service Tracker MCP server

A local **MCP (Model Context Protocol) server** that exposes the Service Tracker's **read-only**
operations as tools, so an MCP client (Claude Desktop) can query your CRM conversationally —
"what's overdue?", "show past jobs like a VRF gas leak", "stock levels". Built with **FastMCP
over the service layer**: each tool calls the app's existing services + SQLite in-process (no
HTTP), acting as a **Service Admin** identity. Nothing here mutates data.

Server: [`backend/app/mcp_server.py`](backend/app/mcp_server.py) · transport: **stdio**.

## Tools
| Tool | Returns |
|------|---------|
| `dashboard_overview` | org counts by status/work-type + attention items + contract mix |
| `search_tickets(query, limit)` | tickets matching a problem description (semantic) or number/customer |
| `get_ticket(ticket)` | full detail + lifecycle timeline for one ticket (number or id) |
| `stock_levels` | per-material received / consumed / available / pending |
| `pms_due` | PMS visits due (on/before today) without a generated ticket |
| `payment_follow_up` | Repaired-Service tickets with an outstanding balance |
| `find_similar_tickets(ticket, limit)` | past tickets semantically similar to a given one |

> The semantic tools (`search_tickets`, `find_similar_tickets`) use the RAG layer. They need
> `AI_ENABLED=true`, Ollama running, and the index built (`POST /ai/reindex` once). If AI is off
> they degrade gracefully — `search_tickets` falls back to number/customer matching.

## Prerequisites
- The app has been run at least once (tables created; run the importers for real data).
- For semantic tools: `ollama serve` + `nomic-embed-text` pulled + one `POST /ai/reindex`.

## Set up in Claude Desktop (Windows)
1. Open the config file (create it if missing):
   `%APPDATA%\Claude\claude_desktop_config.json`
2. Add the `service-tracker` entry:
```json
{
  "mcpServers": {
    "service-tracker": {
      "command": "D:\\Software Development\\01_Service_Tracker - AI Trial\\01_Service_Tracker\\backend\\.venv\\Scripts\\python.exe",
      "args": ["-m", "app.mcp_server"],
      "cwd": "D:\\Software Development\\01_Service_Tracker - AI Trial\\01_Service_Tracker\\backend",
      "env": { "ENV": "production" }
    }
  }
}
```
3. **Fully quit and reopen Claude Desktop.** The `service-tracker` tools appear in the tools menu.
4. Ask: *"Using service-tracker, what's the dashboard overview?"* or *"find tickets like a compressor failure on a package unit."*

`cwd` must point at `backend/` so `.env` and `dev.db` resolve. If your Claude Desktop build
ignores `cwd`, instead add these to `env` (absolute paths):
```json
"PYTHONPATH": "D:\\Software Development\\01_Service_Tracker - AI Trial\\01_Service_Tracker\\backend",
"DATABASE_URL": "sqlite:///D:/Software Development/01_Service_Tracker - AI Trial/01_Service_Tracker/backend/dev.db"
```

## Run / test manually
```bat
cd backend
.venv\Scripts\python -m app.mcp_server      :: starts the stdio server (Ctrl+C to stop)
```
It speaks JSON-RPC over stdio, so there's nothing to "open" — a client drives it. The repo's
verification spawns it and calls tools over the protocol.

## Remote (HTTP) — connect over the network / from the deployed site
The same tools are also served over **streamable HTTP** at **`/mcp`** (behind the outer proxy:
`https://briteai.in/service/mcp`), so remote MCP clients can reach the CRM by URL. It's mounted
only when enabled and is **token-guarded** (`Authorization: Bearer <MCP_TOKEN>`).

Enable it (server `backend/.env.prod`, or local `backend/.env`):
```
MCP_HTTP_ENABLED=true
MCP_TOKEN=<a long random secret>     # openssl rand -hex 32
```
Claude Desktop config (remote):
```json
{
  "mcpServers": {
    "service-tracker-remote": {
      "url": "https://briteai.in/service/mcp",
      "headers": { "Authorization": "Bearer <your MCP_TOKEN>" }
    }
  }
}
```
Unauthenticated requests get `401`. nginx already proxies `/mcp` (streaming, buffering off).

## Notes
- **Read-only** by design. Guarded write tools (create ticket, allocate material) can be added
  later mirroring the app's propose→confirm pattern.
- Same brain, different doorway: reuses the same services + RAG as the in-app assistant.
- Pinned `mcp==1.9.4` (keeps Starlette on 0.41.x for FastAPI 0.115.6 compatibility).
