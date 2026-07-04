@echo off
REM Start Postgres (docker), then the FastAPI backend on :8000.
cd /d "%~dp0"
docker compose up -d db
cd backend
if not exist .venv (
    python -m venv .venv
)
call .venv\Scripts\activate
pip install -r requirements.txt
if not exist .env copy .env.example .env
uvicorn app.main:app --reload --port 8000
