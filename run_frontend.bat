@echo off
REM Start the Vite dev server on :5173 (proxies /api to :8000).
cd /d "%~dp0\frontend"
if not exist node_modules (
    call npm install
)
call npm run dev
