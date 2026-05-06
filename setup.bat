@echo off
REM ═══════════════════════════════════════════════════════════════
REM  InferX Document AI — One-Click Setup Script (Windows)
REM  This script installs all required dependencies for the
REM  InferX Tender Evaluation Platform.
REM ═══════════════════════════════════════════════════════════════

echo.
echo ===================================================
echo    InferX Document AI — Setup Installer (Windows)
echo    AI-Based Tender Evaluation for CRPF
echo ===================================================
echo.

REM ── Step 1: Check Python ──
echo [1/5] Checking Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    python3 --version >nul 2>&1
    if %errorlevel% neq 0 (
        echo [ERROR] Python not found!
        echo Please install Python 3.9+ from https://www.python.org/downloads/
        echo IMPORTANT: Check "Add Python to PATH" during installation.
        pause
        exit /b 1
    )
)
echo [OK] Python found

REM ── Step 2: Check Node.js ──
echo.
echo [2/5] Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found!
    echo Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js found

REM ── Step 3: Setup Python Virtual Environment ──
echo.
echo [3/5] Setting up Python virtual environment...
if not exist "venv" (
    echo   Creating virtual environment...
    python -m venv venv
)
call venv\Scripts\activate.bat

echo   Installing Python packages from requirements.txt...
pip install --upgrade pip >nul 2>&1
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install Python dependencies.
    pause
    exit /b 1
)
echo [OK] Python dependencies installed

REM ── Step 4: Install Frontend Dependencies ──
echo.
echo [4/5] Installing frontend (Node.js) dependencies...
cd frontend
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install frontend dependencies.
    cd ..
    pause
    exit /b 1
)
echo [OK] Frontend dependencies installed
cd ..

REM ── Step 5: Setup .env file ──
echo.
echo [5/5] Checking .env configuration...
if not exist ".env" (
    if exist ".env.example" (
        copy .env.example .env >nul
        echo [ACTION REQUIRED] .env file created from .env.example
        echo   Please edit .env and add your API keys before starting.
    ) else (
        echo [WARNING] No .env or .env.example found!
        echo   Please create a .env file with your API keys. See README.md.
    )
) else (
    echo [OK] .env file already exists
)

REM ── Create required directories ──
if not exist "exports" mkdir exports
if not exist "_uploads" mkdir _uploads
if not exist "audit_logs" mkdir audit_logs

echo.
echo ===================================================
echo    Setup Complete!
echo ===================================================
echo.
echo   To start the application, run:
echo     start.bat
echo.
echo   Or start servers individually:
echo     Backend:  run_backend.bat   (http://localhost:8000)
echo     Frontend: run_frontend.bat  (http://localhost:5173)
echo.
pause
