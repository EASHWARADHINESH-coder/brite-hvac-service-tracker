from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.database import create_db_and_tables
from app.seed import seed_master_data

settings = get_settings()

# Remote MCP server over HTTP (Phase 7) — mounted only when explicitly enabled + a token is set,
# so the CRM tools are never exposed unauthenticated. Building the ASGI app here also creates the
# session manager, which the lifespan runs.
_mcp = None
_mcp_asgi = None
if settings.mcp_http_enabled and settings.mcp_token:
    from app.mcp_server import http_app, mcp as _mcp

    _mcp_asgi = http_app()


class _MCPTokenGuard:
    """ASGI wrapper: require `Authorization: Bearer <MCP_TOKEN>` before reaching the MCP app."""

    def __init__(self, app, token: str):
        self.app = app
        self._expected = f"Bearer {token}".encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            auth = dict(scope.get("headers") or []).get(b"authorization", b"")
            if auth != self._expected:
                await send({"type": "http.response.start", "status": 401,
                            "headers": [(b"content-type", b"application/json")]})
                await send({"type": "http.response.body", "body": b'{"error":"unauthorized"}'})
                return
        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    if settings.seed_demo_data:
        seed_master_data()
    if _mcp is not None:
        # Run the streamable-HTTP session manager for the lifetime of the app.
        async with _mcp.session_manager.run():
            yield
    else:
        yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

if _mcp_asgi is not None:
    # Remote MCP endpoint at /mcp (behind the outer proxy: e.g. briteai.in/service/mcp).
    app.mount("/mcp", _MCPTokenGuard(_mcp_asgi, settings.mcp_token))


@app.get("/")
def root() -> dict[str, str]:
    return {"app": settings.app_name, "docs": "/docs", "health": "/api/v1/health"}
