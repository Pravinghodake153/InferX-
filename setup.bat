@echo off
SETLOCAL EnableDelayedExpansion

REM ═══════════════════════════════════════════════════════════════
REM  InferX Document AI — Windows Setup Script
REM  ═══════════════════════════════════════════════════════════════

echo.
echo ===================================================
echo    InferX Document AI - Windows Setup Installer
echo    AI-Based Tender Evaluation for CRPF
echo ===================================================
echo.

REM ── Step 1: Check Python ──
echo [1/7] Checking Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found.
    echo Please install Python 3.9+ from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
) else (
    for /f "tokens=2" %%v in ('python --version') do echo [OK] Python %%v found
)

REM ── Step 2: Check Node.js ──
echo.
echo [2/7] Checking Node.js (v20+ required)...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found.
    echo Please install Node.js 22 from https://nodejs.org/
    pause
    exit /b 1
) else (
    for /f "tokens=1" %%v in ('node --version') do (
        set NODE_VER=%%v
        set NODE_MAJOR=!NODE_VER:~1,2!
        if !NODE_MAJOR! LSS 20 (
            echo [ERROR] Node.js !NODE_VER! found, but v20+ is required.
            echo Please upgrade to Node.js 22 at https://nodejs.org/
            pause
            exit /b 1
        ) else (
            echo [OK] Node.js !NODE_VER! found
        )
    )
)

REM ── Step 3: Check Tesseract OCR ──
echo.
echo [3/7] Checking Tesseract OCR...
tesseract --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] Tesseract OCR not found in PATH.
    echo Scanned documents will not be processed.
    echo Install from: https://github.com/UB-Mannheim/tesseract/wiki
) else (
    echo [OK] Tesseract OCR found
)

REM ── Step 4: Python venv & Deps ──
echo.
echo [4/7] Setting up Python virtual environment...
if not exist venv (
    python -m venv venv
    echo Virtual environment created.
)

echo Installing Python dependencies...
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install Python dependencies.
    pause
    exit /b 1
)
echo [OK] Python dependencies installed.

REM ── Step 5: Frontend Deps ──
echo.
echo [5/7] Installing frontend dependencies...
cd frontend
call npm install
if %errorlevel% neq 0 (
    echo [RETRY] npm install failed, trying with legacy-peer-deps...
    call npm install --legacy-peer-deps
)
cd ..
echo [OK] Frontend dependencies installed.

REM ── Step 6: Environment Config ──
echo.
echo [6/7] Checking environment configuration...
if not exist .env (
    if exist .env.example (
        copy .env.example .env
        echo .env created from .env.example
    ) else (
        echo [ERROR] .env.example not found. Creating minimal .env
        (
        echo GEMINI_API_KEY=your_gemini_api_key_here
        echo MONGO_URI=mongodb+srv://user:pass@cluster...
        echo LLM_PROVIDER=gemini
        echo VITE_FIREBASE_API_KEY=
        echo VITE_FIREBASE_AUTH_DOMAIN=
        echo VITE_FIREBASE_PROJECT_ID=
        echo VITE_FIREBASE_STORAGE_BUCKET=
        echo VITE_FIREBASE_MESSAGING_SENDER_ID=
        echo VITE_FIREBASE_APP_ID=
        ) > .env
    )
    echo.
    echo IMPORTANT: Please edit .env and add your API keys.
)

if not exist frontend\.env (
    echo Creating frontend\.env...
    findstr /B "VITE_" .env > frontend\.env
    echo VITE_API_URL=http://localhost:8000 >> frontend\.env
)

REM ── Step 7: Finalize ──
echo.
echo [7/7] Creating directories...
if not exist exports mkdir exports
if not exist _uploads mkdir _uploads
if not exist audit_logs mkdir audit_logs

echo.
echo ===================================================
echo    Setup Complete!
echo ===================================================
echo.
echo 1. Edit .env and add your GEMINI_API_KEY and MONGO_URI
echo 2. Run start.bat to launch InferX
echo.
pause
