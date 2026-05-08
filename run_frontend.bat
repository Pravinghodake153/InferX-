@echo off
echo Starting InferX Frontend on port 5173...
cd frontend
if not exist node_modules (
    echo [WARNING] node_modules not found. Installing...
    call npm install
)
call npm run dev
pause
