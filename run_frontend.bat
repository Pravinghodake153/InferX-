@echo off
echo Starting InferX Frontend Server on port 5173...

REM Resolve to script directory
cd /d "%~dp0"

if not exist "frontend\node_modules" (
    echo [WARNING] node_modules not found. Installing dependencies...
    cd frontend
    call npm install
    cd ..
)

cd frontend
call npm run dev
