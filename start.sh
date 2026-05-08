#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  InferX Document AI — Start Both Servers
#  Launches backend (port 8000) and frontend (port 5173)
#
#  Usage:
#    ./start.sh
#
#  Prerequisites:
#    Run ./setup.sh first to install all dependencies.
# ═══════════════════════════════════════════════════════════════

# Resolve script directory (works even if called from another path)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   InferX Document AI — Starting Servers${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

# ══════════════════════════════════════════════════════════
# Pre-flight Checks
# ══════════════════════════════════════════════════════════

echo -e "${CYAN}Running pre-flight checks...${NC}"
echo ""

# Check 1: .env file exists
if [ ! -f ".env" ]; then
    echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ERROR: .env file not found!                                ║${NC}"
    echo -e "${RED}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${RED}║  The .env file contains required API keys (Gemini, MongoDB, ║${NC}"
    echo -e "${RED}║  Firebase) without which the application cannot function.   ║${NC}"
    echo -e "${RED}║                                                             ║${NC}"
    echo -e "${RED}║  FIX: Run ./setup.sh first, then edit .env with your keys.  ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} .env file found"

# Check 2: API keys are configured (not placeholder values)
GEMINI_KEY=$(grep "^GEMINI_API_KEY=" .env | cut -d= -f2)
MONGO_KEY=$(grep "^MONGO_URI=" .env | cut -d= -f2)

if [ -z "$GEMINI_KEY" ] || [ "$GEMINI_KEY" = "your_gemini_api_key_here" ]; then
    echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ERROR: GEMINI_API_KEY is not configured!                   ║${NC}"
    echo -e "${RED}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${RED}║  The AI evaluation engine requires a Google Gemini API key. ║${NC}"
    echo -e "${RED}║                                                             ║${NC}"
    echo -e "${RED}║  HOW TO GET ONE (free):                                     ║${NC}"
    echo -e "${RED}║  1. Go to https://aistudio.google.com/apikey                ║${NC}"
    echo -e "${RED}║  2. Click 'Create API Key'                                  ║${NC}"
    echo -e "${RED}║  3. Copy the key and paste it in .env file:                 ║${NC}"
    echo -e "${RED}║     GEMINI_API_KEY=AIzaSy...                                ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} GEMINI_API_KEY configured"

if [ -z "$MONGO_KEY" ] || echo "$MONGO_KEY" | grep -q "your_user\|<db_password>"; then
    echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║  WARNING: MONGO_URI is not configured or has placeholders!  ║${NC}"
    echo -e "${YELLOW}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${YELLOW}║  Without MongoDB, project data will NOT persist across      ║${NC}"
    echo -e "${YELLOW}║  sessions. The app will still run, but data will be lost    ║${NC}"
    echo -e "${YELLOW}║  when the server restarts.                                  ║${NC}"
    echo -e "${YELLOW}║                                                             ║${NC}"
    echo -e "${YELLOW}║  HOW TO GET ONE (free):                                     ║${NC}"
    echo -e "${YELLOW}║  1. Go to https://cloud.mongodb.com                         ║${NC}"
    echo -e "${YELLOW}║  2. Create a free M0 cluster                                ║${NC}"
    echo -e "${YELLOW}║  3. Get connection string → paste in .env:                  ║${NC}"
    echo -e "${YELLOW}║     MONGO_URI=mongodb+srv://user:pass@cluster...            ║${NC}"
    echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${YELLOW}⚠${NC}  MONGO_URI not configured (continuing without persistence)"
else
    echo -e "  ${GREEN}✓${NC} MONGO_URI configured"
fi

# Check 3: Python venv exists
if [ ! -d "venv" ]; then
    echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ERROR: Python virtual environment not found!               ║${NC}"
    echo -e "${RED}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${RED}║  The backend server requires Python dependencies to be      ║${NC}"
    echo -e "${RED}║  installed in a virtual environment.                        ║${NC}"
    echo -e "${RED}║                                                             ║${NC}"
    echo -e "${RED}║  FIX: Run ./setup.sh to install all dependencies.           ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Python virtual environment found"

# Check 4: uvicorn is installed
if [ ! -f "venv/bin/uvicorn" ]; then
    echo -e "${YELLOW}[FIX]${NC} uvicorn not found in venv. Installing..."
    source venv/bin/activate
    pip install uvicorn fastapi python-multipart 2>&1 | tail -3
    if [ ! -f "venv/bin/uvicorn" ]; then
        echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}║  ERROR: Failed to install uvicorn (backend server).         ║${NC}"
        echo -e "${RED}╠══════════════════════════════════════════════════════════════╣${NC}"
        echo -e "${RED}║  FIX: Run these commands manually:                          ║${NC}"
        echo -e "${RED}║    source venv/bin/activate                                 ║${NC}"
        echo -e "${RED}║    pip install uvicorn fastapi python-multipart              ║${NC}"
        echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
        exit 1
    fi
fi
echo -e "  ${GREEN}✓${NC} uvicorn (backend server) installed"

# Check 5: Frontend node_modules
if [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}[FIX]${NC} Frontend dependencies missing. Installing..."
    cd frontend
    npm install 2>&1 | tail -5
    cd ..
    if [ ! -d "frontend/node_modules" ]; then
        echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}║  ERROR: Frontend dependencies could not be installed!       ║${NC}"
        echo -e "${RED}╠══════════════════════════════════════════════════════════════╣${NC}"
        echo -e "${RED}║  FIX: Run these commands manually:                          ║${NC}"
        echo -e "${RED}║    cd frontend                                              ║${NC}"
        echo -e "${RED}║    npm install                                              ║${NC}"
        echo -e "${RED}║    cd ..                                                    ║${NC}"
        echo -e "${RED}║                                                             ║${NC}"
        echo -e "${RED}║  Make sure Node.js v20+ is installed: node --version        ║${NC}"
        echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
        exit 1
    fi
fi
echo -e "  ${GREEN}✓${NC} Frontend dependencies installed"

# Check 6: frontend/.env has Firebase keys
if [ ! -f "frontend/.env" ]; then
    echo -e "${YELLOW}[FIX]${NC} frontend/.env missing. Creating from root .env..."
    grep "^VITE_" .env > frontend/.env 2>/dev/null
    echo "VITE_API_URL=http://localhost:8000" >> frontend/.env
fi
echo -e "  ${GREEN}✓${NC} frontend/.env configured"

# Check 7: Tesseract OCR
if command -v tesseract &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} Tesseract OCR available"
else
    echo -e "  ${YELLOW}⚠${NC}  Tesseract OCR not found (scanned documents won't be processed)"
fi

echo ""
echo -e "${GREEN}All pre-flight checks passed!${NC}"
echo ""

# Create required directories
mkdir -p exports _uploads audit_logs

# ══════════════════════════════════════════════════════════
# Start Servers
# ══════════════════════════════════════════════════════════

# Start Backend
echo -e "${YELLOW}[1/2]${NC} Starting Backend Server (port 8000)..."
source venv/bin/activate
venv/bin/uvicorn app.api:app --reload --port 8000 &
BACKEND_PID=$!
echo -e "${GREEN}[OK]${NC} Backend started (PID: $BACKEND_PID)"

# Wait for backend to boot
sleep 2

# Verify backend is actually running
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ERROR: Backend server crashed on startup!                  ║${NC}"
    echo -e "${RED}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${RED}║  This usually means a Python import failed.                ║${NC}"
    echo -e "${RED}║                                                             ║${NC}"
    echo -e "${RED}║  FIX: Try running the backend directly to see the error:    ║${NC}"
    echo -e "${RED}║    source venv/bin/activate                                 ║${NC}"
    echo -e "${RED}║    python -m uvicorn app.api:app --port 8000                ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
    exit 1
fi

# Start Frontend
echo -e "${YELLOW}[2/2]${NC} Starting Frontend Server (port 5173)..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..
echo -e "${GREEN}[OK]${NC} Frontend started (PID: $FRONTEND_PID)"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}   ✅ InferX is running!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}Open in your browser:${NC}"
echo -e "    Frontend: ${BLUE}http://localhost:5173${NC}"
echo -e "    Backend:  ${BLUE}http://localhost:8000${NC}"
echo -e "    API Docs: ${BLUE}http://localhost:8000/docs${NC}"
echo ""
echo -e "  Press ${RED}Ctrl+C${NC} to stop all servers."
echo ""

# Trap Ctrl+C to kill both
trap "echo ''; echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM

# Wait for both
wait
