@echo off
REM ═══════════════════════════════════════════════════════════════
REM  InferX Document AI — Start Both Servers (Windows)
REM  ═══════════════════════════════════════════════════════════════

echo.
echo ===================================================
echo    InferX Document AI - Launching Servers
echo ===================================================
echo.

if not exist .env (
    echo [ERROR] .env file not found. Run setup.bat first.
    pause
    exit /b 1
)

echo Starting Backend in a new window...
start "InferX Backend" cmd /c run_backend.bat

timeout /t 3 /nobreak >nul

echo Starting Frontend in a new window...
start "InferX Frontend" cmd /c run_frontend.bat

echo.
echo ===================================================
echo    Both servers are starting!
echo.
echo    Frontend: http://localhost:5173
echo    Backend:  http://localhost:8000
echo ===================================================
echo.
echo Close the separate windows to stop the servers.
pause
