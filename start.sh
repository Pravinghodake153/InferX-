#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  InferX Document AI — Start Both Servers
#  Launches backend (port 8000) and frontend (port 5173)
# ═══════════════════════════════════════════════════════════════

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

# Check node_modules
if [ ! -d "frontend/node_modules" ]; then
    echo -e "${RED}[ERROR]${NC} Frontend dependencies not installed!"
    echo "  Run ./setup.sh first to install dependencies."
    exit 1
fi

# Create required directories
mkdir -p exports _uploads audit_logs

# Start Backend
echo -e "${YELLOW}[1/2]${NC} Starting Backend Server (port 8000)..."
source venv/bin/activate
uvicorn app.api:app --reload --port 8000 &
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
