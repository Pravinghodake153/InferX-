#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  InferX Document AI — One-Click Setup Script
#  This script installs all required dependencies for the
#  InferX Tender Evaluation Platform.
#
#  Supported: macOS (Homebrew) / Ubuntu/Debian (apt)
# ═══════════════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   InferX Document AI — Setup Installer${NC}"
echo -e "${BLUE}   AI-Based Tender Evaluation for CRPF${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

# ── Detect OS ──
OS="unknown"
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="mac"
    echo -e "${GREEN}[OK]${NC} Detected macOS"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    echo -e "${GREEN}[OK]${NC} Detected Linux"
else
    echo -e "${RED}[ERROR]${NC} Unsupported OS: $OSTYPE"
    echo "This script supports macOS and Ubuntu/Debian Linux."
    exit 1
fi

# ── Step 1: Check / Install Python ──
echo ""
echo -e "${YELLOW}[1/6]${NC} Checking Python..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version 2>&1)
    echo -e "${GREEN}[OK]${NC} $PYTHON_VERSION found"
else
    echo -e "${YELLOW}[INSTALLING]${NC} Python3 not found. Installing..."
    if [[ "$OS" == "mac" ]]; then
        brew install python3
    else
        sudo apt-get update && sudo apt-get install -y python3 python3-pip python3-venv
    fi
fi

# ── Step 2: Check / Install Node.js ──
echo ""
echo -e "${YELLOW}[2/6]${NC} Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version 2>&1)
    echo -e "${GREEN}[OK]${NC} Node.js $NODE_VERSION found"
else
    echo -e "${YELLOW}[INSTALLING]${NC} Node.js not found. Installing..."
    if [[ "$OS" == "mac" ]]; then
        brew install node
    else
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
fi

# ── Step 3: Check / Install Tesseract OCR ──
echo ""
echo -e "${YELLOW}[3/6]${NC} Checking Tesseract OCR..."
if command -v tesseract &> /dev/null; then
    TESS_VERSION=$(tesseract --version 2>&1 | head -1)
    echo -e "${GREEN}[OK]${NC} $TESS_VERSION found"
else
    echo -e "${YELLOW}[INSTALLING]${NC} Tesseract OCR not found. Installing..."
    if [[ "$OS" == "mac" ]]; then
        brew install tesseract tesseract-lang
    else
        sudo apt-get update && sudo apt-get install -y tesseract-ocr tesseract-ocr-hin
    fi
fi

# ── Step 4: Install Python Dependencies ──
echo ""
echo -e "${YELLOW}[4/6]${NC} Setting up Python virtual environment and dependencies..."

if [ ! -d "venv" ]; then
    echo "  Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate
echo "  Installing Python packages from requirements.txt..."
pip install --upgrade pip > /dev/null 2>&1
pip install -r requirements.txt 2>&1 | tail -1
echo -e "${GREEN}[OK]${NC} Python dependencies installed"

# ── Step 5: Install Frontend Dependencies ──
echo ""
echo -e "${YELLOW}[5/6]${NC} Installing frontend (Node.js) dependencies..."
cd frontend
npm install 2>&1 | tail -3
echo -e "${GREEN}[OK]${NC} Frontend dependencies installed"
cd ..

# ── Step 6: Setup .env file ──
echo ""
echo -e "${YELLOW}[6/6]${NC} Checking .env configuration..."

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${YELLOW}[ACTION REQUIRED]${NC} .env file created from .env.example"
        echo -e "${YELLOW}  Please edit .env and add your API keys before starting.${NC}"
    else
        echo -e "${RED}[WARNING]${NC} No .env or .env.example found!"
        echo "  Please create a .env file with your API keys. See README.md for details."
    fi
else
    echo -e "${GREEN}[OK]${NC} .env file already exists"
fi

# ── Create required directories ──
mkdir -p exports _uploads audit_logs

# ── Make scripts executable ──
chmod +x run_backend.sh run_frontend.sh start.sh 2>/dev/null || true

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}   Setup Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  To start the application, run:"
echo -e "    ${BLUE}./start.sh${NC}"
echo ""
echo -e "  Or start servers individually:"
echo -e "    Backend:  ${BLUE}./run_backend.sh${NC}   (http://localhost:8000)"
echo -e "    Frontend: ${BLUE}./run_frontend.sh${NC}  (http://localhost:5173)"
echo ""
