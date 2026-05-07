@echo off
REM ═══════════════════════════════════════════════════════════════
REM  InferX Document AI — One-Click Setup Script (Windows)
REM  This script installs all required dependencies for the
REM  InferX Tender Evaluation Platform.
REM ═══════════════════════════════════════════════════════════════

REM Resolve to script directory
cd /d "%~dp0"

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

echo   Upgrading pip...
pip install --upgrade pip >nul 2>&1

echo   Installing core Python packages...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [WARNING] Some packages failed. Retrying critical ones...
    pip install uvicorn fastapi pydantic python-dotenv python-multipart PyMuPDF pytesseract
)

echo   Installing PaddleOCR (optional)...
pip install paddlepaddle paddleocr >nul 2>&1
if %errorlevel% neq 0 (
    echo   [SKIP] PaddleOCR not available on this platform. Tesseract OCR will be used.
) else (
    echo   [OK] PaddleOCR installed
)

echo [OK] Python dependencies installed

REM Verify uvicorn
if not exist "venv\Scripts\uvicorn.exe" (
    echo [WARNING] uvicorn missing. Reinstalling...
    pip install uvicorn
)

REM ── Step 4: Install Frontend Dependencies ──
echo.
echo [4/5] Installing frontend (Node.js) dependencies...
cd frontend
call npm install
if %errorlevel% neq 0 (
    echo [WARNING] npm install had errors. Retrying with --legacy-peer-deps...
    call npm install --legacy-peer-deps
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
        echo # InferX Document AI — Environment Configuration > .env
        echo # Add your API keys below >> .env
        echo GEMINI_API_KEY= >> .env
        echo OPENROUTER_API_KEY= >> .env
        echo AI_PROVIDER=gemini >> .env
        echo AI_MODEL=gemini-2.5-flash >> .env
        echo [CREATED] .env file created with defaults
        echo   Please edit .env and add your API keys before starting.
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
