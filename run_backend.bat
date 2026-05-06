@echo off
echo Starting InferX Backend Server on port 8000...
call venv\Scripts\activate.bat
uvicorn app.api:app --reload --port 8000
