@echo off
REM ═══════════════════════════════════════════════════════════════
REM  InferX Document AI — Start Both Servers (Windows)
REM  Launches backend (port 8000) and frontend (port 5173)
REM ═══════════════════════════════════════════════════════════════

REM Resolve to script directory
cd /d "%~dp0"

echo.
echo ===================================================
echo    InferX Document AI — Starting Servers
echo ===================================================
echo.

REM Check .env
if not exist ".env" (
    echo [ERROR] .env file not found!
    echo   Run setup.bat first, then add your API keys to .env
    pause
    exit /b 1
)

REM Check venv
if not exist "venv\Scripts\activate.bat" (
    echo [ERROR] Python virtual environment not found!
    echo   Run setup.bat first to install dependencies.
    pause
    exit /b 1
)

REM Check uvicorn — auto-fix if missing
if not exist "venv\Scripts\uvicorn.exe" (
    echo [FIX] uvicorn not found in venv. Installing...
    call venv\Scripts\activate.bat
    pip install uvicorn fastapi python-multipart
)

REM Check node_modules — auto-fix if missing
if not exist "frontend\node_modules" (
    echo [FIX] Frontend dependencies missing. Installing...
    cd frontend
    call npm install
    cd ..
    if not exist "frontend\node_modules" (
        echo [ERROR] Frontend install failed. Try: cd frontend ^&^& npm install
        pause
        exit /b 1
    )
)

REM Create required directories
if not exist "exports" mkdir exports
if not exist "_uploads" mkdir _uploads
if not exist "audit_logs" mkdir audit_logs

REM Start Backend in a new window
echo [1/2] Starting Backend Server (port 8000)...
start "InferX Backend" cmd /k "cd /d "%~dp0" && call venv\Scripts\activate.bat && venv\Scripts\uvicorn.exe app.api:app --reload --port 8000"

REM Wait for backend to boot
timeout /t 3 /nobreak >nul

REM Start Frontend in a new window
echo [2/2] Starting Frontend Server (port 5173)...
start "InferX Frontend" cmd /k "cd /d "%~dp0\frontend" && npm run dev"

echo.
echo ===================================================
echo    InferX is running!
echo ===================================================
echo.
echo   Frontend: http://localhost:5173
echo   Backend:  http://localhost:8000
echo   API Docs: http://localhost:8000/docs
echo.
echo   Close the server windows to stop.
echo.
pause
