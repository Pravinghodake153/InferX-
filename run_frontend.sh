#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  InferX Document AI — Frontend Server
#  Launches Vite dev server on port 5173
# ═══════════════════════════════════════════════════════════════

# Resolve script directory (works even if called from another path)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Starting InferX Frontend Server on port 5173...${NC}"

if [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}[WARNING] node_modules not found. Installing dependencies...${NC}"
    cd frontend
    npm install 2>&1 | tail -5
    cd ..
fi

if [ -d "frontend/node_modules" ]; then
    cd frontend
    echo -e "${GREEN}[OK]${NC} Launching Vite..."
    npm run dev
else
    echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ERROR: Frontend dependencies not found!                     ║${NC}"
    echo -e "${RED}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${RED}║  Please run ./setup.sh or manually: cd frontend && npm install║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
    exit 1
fi
