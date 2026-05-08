@echo off
echo Starting InferX Backend on port 8000...
if not exist venv\Scripts\activate.bat (
    echo [ERROR] Virtual environment not found. Run setup.bat first.
    pause
    exit /b 1
)
call venv\Scripts\activate.bat
uvicorn app.api:app --reload --port 8000
pause
