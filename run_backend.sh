#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  InferX Document AI — Backend Server
#  Launches FastAPI on port 8000
# ═══════════════════════════════════════════════════════════════

# Resolve script directory (works even if called from another path)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Starting InferX Backend Server on port 8000...${NC}"

# Check .env
if [ ! -f ".env" ]; then
    echo -e "${RED}[ERROR]${NC} .env file not found!"
    echo "  Run ./setup.sh first to create it."
    exit 1
fi

# Activate virtual environment
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
else
    echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ERROR: Virtual environment not found!                      ║${NC}"
    echo -e "${RED}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${RED}║  Please run ./setup.sh to install all dependencies first.    ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
    exit 1
fi

# Use the venv's uvicorn directly to avoid PATH issues
if [ -f "venv/bin/uvicorn" ]; then
    echo -e "${GREEN}[OK]${NC} Launching uvicorn..."
    venv/bin/uvicorn app.api:app --reload --port 8000
else
    echo -e "${RED}[ERROR]${NC} uvicorn not found in virtual environment."
    echo "  Attempting to fix..."
    pip install uvicorn fastapi python-multipart
    if [ -f "venv/bin/uvicorn" ]; then
        venv/bin/uvicorn app.api:app --reload --port 8000
    else
        echo -e "${RED}FAILED to launch. Run: source venv/bin/activate && pip install uvicorn${NC}"
        exit 1
    fi
fi
