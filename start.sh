#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  InferX Document AI — Start Both Servers
#  Launches backend (port 8000) and frontend (port 5173)
# ═══════════════════════════════════════════════════════════════

# Resolve script directory (works even if called from another path)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   InferX Document AI — Starting Servers${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

# Check .env
if [ ! -f ".env" ]; then
    echo -e "${RED}[ERROR]${NC} .env file not found!"
    echo "  Run ./setup.sh first, then add your API keys to .env"
    exit 1
fi

# Check venv
if [ ! -d "venv" ]; then
    echo -e "${RED}[ERROR]${NC} Python virtual environment not found!"
    echo "  Run ./setup.sh first to install dependencies."
    exit 1
fi

# Check uvicorn is actually installed
if [ ! -f "venv/bin/uvicorn" ]; then
    echo -e "${YELLOW}[FIX]${NC} uvicorn not found in venv. Installing..."
    source venv/bin/activate
    pip install uvicorn fastapi python-multipart 2>&1 | tail -3
fi

# Check node_modules — auto-install if missing
if [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}[FIX]${NC} Frontend dependencies missing. Installing..."
    cd frontend
    npm install 2>&1 | tail -5
    cd ..
    if [ ! -d "frontend/node_modules" ]; then
        echo -e "${RED}[ERROR]${NC} Frontend install failed. Try: cd frontend && npm install"
        exit 1
    fi
fi

# Create required directories
mkdir -p exports _uploads audit_logs

# Start Backend
echo -e "${YELLOW}[1/2]${NC} Starting Backend Server (port 8000)..."
source venv/bin/activate
venv/bin/uvicorn app.api:app --reload --port 8000 &
BACKEND_PID=$!
echo -e "${GREEN}[OK]${NC} Backend started (PID: $BACKEND_PID)"

# Wait for backend to boot
sleep 2

# Start Frontend
echo -e "${YELLOW}[2/2]${NC} Starting Frontend Server (port 5173)..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..
echo -e "${GREEN}[OK]${NC} Frontend started (PID: $FRONTEND_PID)"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}   InferX is running!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Frontend: ${BLUE}http://localhost:5173${NC}"
echo -e "  Backend:  ${BLUE}http://localhost:8000${NC}"
echo -e "  API Docs: ${BLUE}http://localhost:8000/docs${NC}"
echo ""
echo -e "  Press ${RED}Ctrl+C${NC} to stop all servers."
echo ""

# Trap Ctrl+C to kill both
trap "echo ''; echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM

# Wait for both
wait
