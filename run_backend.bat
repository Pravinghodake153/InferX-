@echo off
echo Starting InferX Backend Server on port 8000...

REM Resolve to script directory
cd /d "%~dp0"

if not exist "venv\Scripts\activate.bat" (
    echo [ERROR] Virtual environment not found at venv\
    echo   Run setup.bat first to create it.
    pause
    exit /b 1
)

call venv\Scripts\activate.bat

REM Use full path to uvicorn as fallback
if exist "venv\Scripts\uvicorn.exe" (
    venv\Scripts\uvicorn.exe app.api:app --reload --port 8000
) else (
    echo [ERROR] uvicorn not found in virtual environment.
    echo   Run: venv\Scripts\activate.bat ^&^& pip install uvicorn
    pause
    exit /b 1
)
