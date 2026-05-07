#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  InferX Document AI — One-Click Setup Script
#  This script installs all required dependencies for the
#  InferX Tender Evaluation Platform.
#
#  Supported: macOS (Homebrew) / Ubuntu/Debian (apt)
# ═══════════════════════════════════════════════════════════════

# Resolve script directory (works even if called from another path)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

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

# Activate venv
source venv/bin/activate

echo "  Upgrading pip..."
pip install --upgrade pip > /dev/null 2>&1

echo "  Installing core Python packages from requirements.txt..."
pip install -r requirements.txt 2>&1 | grep -E "(Successfully|ERROR|already satisfied)" | tail -5

# Verify uvicorn is installed (critical dependency)
if ! venv/bin/python -c "import uvicorn" 2>/dev/null; then
    echo -e "${RED}[ERROR]${NC} uvicorn failed to install. Retrying..."
    pip install uvicorn fastapi python-multipart 2>&1
fi

# Install PaddleOCR conditionally (fails on some platforms like macOS ARM)
echo "  Installing PaddleOCR (optional, for advanced OCR)..."
pip install paddlepaddle paddleocr 2>/dev/null && \
    echo -e "${GREEN}  [OK]${NC} PaddleOCR installed" || \
    echo -e "${YELLOW}  [SKIP]${NC} PaddleOCR not available on this platform. Tesseract OCR will be used instead."

echo -e "${GREEN}[OK]${NC} Python dependencies installed"

# Verify critical packages
echo "  Verifying critical packages..."
MISSING=""
for pkg in uvicorn fastapi pydantic pymupdf pytesseract; do
    if ! venv/bin/python -c "import $pkg" 2>/dev/null; then
        MISSING="$MISSING $pkg"
    fi
done

if [ -n "$MISSING" ]; then
    echo -e "${RED}[WARNING]${NC} Missing packages:$MISSING"
    echo "  Attempting reinstall..."
    pip install $MISSING 2>&1
else
    echo -e "${GREEN}  [OK]${NC} All critical packages verified"
fi

# ── Step 5: Install Frontend Dependencies ──
echo ""
echo -e "${YELLOW}[5/6]${NC} Installing frontend (Node.js) dependencies..."
cd frontend
npm install 2>&1 | tail -5
cd ..

# Verify frontend installed
if [ -d "frontend/node_modules" ] && [ -d "frontend/node_modules/.vite" ] || [ -d "frontend/node_modules/react" ]; then
    echo -e "${GREEN}[OK]${NC} Frontend dependencies installed"
else
    echo -e "${YELLOW}[RETRY]${NC} Retrying frontend install..."
    cd frontend
    npm install --legacy-peer-deps 2>&1 | tail -5
    cd ..
    if [ -d "frontend/node_modules" ]; then
        echo -e "${GREEN}[OK]${NC} Frontend dependencies installed (with legacy peer deps)"
    else
        echo -e "${RED}[ERROR]${NC} Frontend install failed. Try manually: cd frontend && npm install"
    fi
fi

# ── Step 6: Setup .env file ──
echo ""
echo -e "${YELLOW}[6/6]${NC} Checking .env configuration..."

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${YELLOW}[ACTION REQUIRED]${NC} .env file created from .env.example"
        echo -e "${YELLOW}  Please edit .env and add your API keys before starting.${NC}"
    else
        # Create minimal .env
        cat > .env << 'EOF'
# InferX Document AI — Environment Configuration
# Add your API keys below

# Google Gemini API Key (primary provider)
GEMINI_API_KEY=

# OpenRouter API Key (fallback provider)
OPENROUTER_API_KEY=

# AI Provider: gemini or openrouter
AI_PROVIDER=gemini

# AI Model ID
AI_MODEL=gemini-2.5-flash

# Sandbox API (optional)
SANDBOX_API_URL=
SANDBOX_API_KEY=
EOF
        echo -e "${YELLOW}[CREATED]${NC} .env file created with defaults"
        echo -e "${YELLOW}  Please edit .env and add your API keys before starting.${NC}"
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
