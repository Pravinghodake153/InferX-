#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  InferX Document AI — One-Click Setup Script
#  This script installs all required dependencies for the
#  InferX Tender Evaluation Platform.
#
#  Supported: macOS (Homebrew) / Ubuntu/Debian (apt)
#
#  Usage:
#    chmod +x setup.sh
#    ./setup.sh
# ═══════════════════════════════════════════════════════════════

# Resolve script directory (works even if called from another path)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

ERRORS=()

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
elif [[ "$OSTYPE" == "msys"* ]] || [[ "$OSTYPE" == "cygwin"* ]]; then
    OS="windows"
    echo -e "${GREEN}[OK]${NC} Detected Windows (Git Bash / MSYS)"
else
    echo -e "${RED}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ERROR: Unsupported Operating System             ║${NC}"
    echo -e "${RED}╠══════════════════════════════════════════════════╣${NC}"
    echo -e "${RED}║  Detected: $OSTYPE${NC}"
    echo -e "${RED}║  InferX requires macOS, Ubuntu/Debian Linux,     ║${NC}"
    echo -e "${RED}║  or Windows with Git Bash.                       ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════╝${NC}"
    exit 1
fi

# ══════════════════════════════════════════════════════════
# Step 1: Check / Install Python 3.9+
# ══════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[1/7]${NC} Checking Python..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version 2>&1)
    echo -e "${GREEN}[OK]${NC} $PYTHON_VERSION found"
else
    echo -e "${YELLOW}[INSTALLING]${NC} Python3 not found. Installing..."
    if [[ "$OS" == "mac" ]]; then
        if command -v brew &> /dev/null; then
            brew install python3
        else
            ERRORS+=("Python3 is not installed and Homebrew is not available. Install Python 3.9+ from https://www.python.org/downloads/")
            echo -e "${RED}[FAILED]${NC} Cannot install Python. Homebrew not found."
            echo -e "${RED}  FIX: Install Homebrew first: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"${NC}"
            echo -e "${RED}  Then re-run ./setup.sh${NC}"
        fi
    elif [[ "$OS" == "linux" ]]; then
        sudo apt-get update && sudo apt-get install -y python3 python3-pip python3-venv
    else
        ERRORS+=("Python3 is not installed. Download from https://www.python.org/downloads/")
    fi
fi

# ══════════════════════════════════════════════════════════
# Step 2: Check / Install Node.js 20+
# ══════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[2/7]${NC} Checking Node.js (v20+ required for Vite)..."
NODE_OK=false
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version 2>&1)
    NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null; then
        echo -e "${GREEN}[OK]${NC} Node.js $NODE_VERSION found (meets v20+ requirement)"
        NODE_OK=true
    else
        echo -e "${RED}[OUTDATED]${NC} Node.js $NODE_VERSION found, but v20+ is required."
        echo -e "${YELLOW}  The frontend build tool (Vite) requires Node.js 20.19+ or 22.12+${NC}"
        if [[ "$OS" == "mac" ]]; then
            echo -e "${YELLOW}  Upgrading via Homebrew...${NC}"
            brew upgrade node 2>/dev/null || brew install node
        elif [[ "$OS" == "linux" ]]; then
            echo -e "${YELLOW}  Upgrading via NodeSource...${NC}"
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
            sudo apt-get install -y nodejs
        fi
        # Re-check
        if command -v node &> /dev/null; then
            NODE_VERSION=$(node --version 2>&1)
            NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
            if [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null; then
                echo -e "${GREEN}[OK]${NC} Node.js upgraded to $NODE_VERSION"
                NODE_OK=true
            fi
        fi
        if [ "$NODE_OK" = false ]; then
            ERRORS+=("Node.js v20+ is required but could not be installed. Download from https://nodejs.org/en/download")
        fi
    fi
else
    echo -e "${YELLOW}[INSTALLING]${NC} Node.js not found. Installing v22..."
    if [[ "$OS" == "mac" ]]; then
        if command -v brew &> /dev/null; then
            brew install node
        else
            ERRORS+=("Node.js is not installed and Homebrew is not available. Download Node.js 22 from https://nodejs.org/en/download")
        fi
    elif [[ "$OS" == "linux" ]]; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        ERRORS+=("Node.js is not installed. Download Node.js 22 from https://nodejs.org/en/download")
    fi
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version 2>&1)
        echo -e "${GREEN}[OK]${NC} Node.js $NODE_VERSION installed"
        NODE_OK=true
    fi
fi

# ══════════════════════════════════════════════════════════
# Step 3: Check / Install Tesseract OCR
# ══════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[3/7]${NC} Checking Tesseract OCR..."
if command -v tesseract &> /dev/null; then
    TESS_VERSION=$(tesseract --version 2>&1 | head -1)
    echo -e "${GREEN}[OK]${NC} $TESS_VERSION found"
else
    echo -e "${YELLOW}[INSTALLING]${NC} Tesseract OCR not found. Installing..."
    if [[ "$OS" == "mac" ]]; then
        brew install tesseract tesseract-lang
    elif [[ "$OS" == "linux" ]]; then
        sudo apt-get update && sudo apt-get install -y tesseract-ocr tesseract-ocr-hin
    else
        ERRORS+=("Tesseract OCR is not installed. Download from https://github.com/UB-Mannheim/tesseract/wiki")
    fi
    if command -v tesseract &> /dev/null; then
        echo -e "${GREEN}[OK]${NC} Tesseract OCR installed"
    else
        ERRORS+=("Tesseract OCR could not be installed. The system will not be able to process scanned/image documents.")
    fi
fi

# ══════════════════════════════════════════════════════════
# Step 4: Install Python Dependencies
# ══════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[4/7]${NC} Setting up Python virtual environment and dependencies..."

if [ ! -d "venv" ]; then
    echo "  Creating virtual environment..."
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo -e "${RED}[ERROR]${NC} Failed to create Python virtual environment."
        echo -e "${RED}  FIX (Linux): sudo apt-get install python3-venv${NC}"
        echo -e "${RED}  FIX (Mac):   brew install python3${NC}"
        ERRORS+=("Python venv creation failed. Install python3-venv package.")
    fi
fi

if [ -d "venv" ]; then
    # Activate venv
    source venv/bin/activate

    echo "  Upgrading pip..."
    pip install --upgrade pip > /dev/null 2>&1

    echo "  Installing core Python packages from requirements.txt..."
    pip install -r requirements.txt 2>&1 | grep -E "(Successfully|ERROR|already satisfied)" | tail -5

    # Verify uvicorn is installed (critical dependency)
    if ! venv/bin/python -c "import uvicorn" 2>/dev/null; then
        echo -e "${RED}[RETRY]${NC} uvicorn failed to install. Retrying..."
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
    for pkg in uvicorn fastapi pydantic pymupdf pytesseract pymongo; do
        if ! venv/bin/python -c "import $pkg" 2>/dev/null; then
            MISSING="$MISSING $pkg"
        fi
    done

    if [ -n "$MISSING" ]; then
        echo -e "${RED}[WARNING]${NC} Missing packages:$MISSING"
        echo "  Attempting reinstall..."
        pip install $MISSING 2>&1
    else
        echo -e "${GREEN}  [OK]${NC} All critical packages verified (fastapi, uvicorn, pymupdf, pytesseract, pymongo)"
    fi
fi

# ══════════════════════════════════════════════════════════
# Step 5: Install Frontend Dependencies
# ══════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[5/7]${NC} Installing frontend (Node.js) dependencies..."
if [ "$NODE_OK" = true ] || command -v node &> /dev/null; then
    cd frontend
    npm install 2>&1 | tail -5
    cd ..

    # Verify frontend installed
    if [ -d "frontend/node_modules" ] && [ -d "frontend/node_modules/.vite" ] || [ -d "frontend/node_modules/react" ]; then
        echo -e "${GREEN}[OK]${NC} Frontend dependencies installed"
    else
        echo -e "${YELLOW}[RETRY]${NC} Retrying frontend install with legacy peer deps..."
        cd frontend
        npm install --legacy-peer-deps 2>&1 | tail -5
        cd ..
        if [ -d "frontend/node_modules" ]; then
            echo -e "${GREEN}[OK]${NC} Frontend dependencies installed (with legacy peer deps)"
        else
            ERRORS+=("Frontend npm install failed. Try manually: cd frontend && npm install")
        fi
    fi
else
    echo -e "${RED}[SKIP]${NC} Skipping frontend install — Node.js is not available."
    ERRORS+=("Frontend dependencies not installed because Node.js is missing.")
fi

# ══════════════════════════════════════════════════════════
# Step 6: Setup .env files
# ══════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[6/7]${NC} Checking environment configuration..."

# Root .env (backend)
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${YELLOW}[CREATED]${NC} .env file created from .env.example"
    else
        cat > .env << 'EOF'
# ═══════════════════════════════════════════════════════════════
# InferX Document AI — Environment Configuration
# Fill in your API keys below. At least GEMINI_API_KEY is required.
# ═══════════════════════════════════════════════════════════════

# ── AI Provider Keys (Required — at least one) ──
# Get from: https://aistudio.google.com/apikey
GEMINI_API_KEY=your_gemini_api_key_here

# Get from: https://openrouter.ai/keys
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Default LLM provider: "gemini" or "openrouter"
LLM_PROVIDER=gemini

# ── MongoDB Atlas (Required for data persistence) ──
# Get from: https://cloud.mongodb.com → Connect → Drivers → Connection String
# Replace <db_password> with your actual database user password
MONGO_URI=mongodb+srv://your_user:<db_password>@cluster0.xxxxx.mongodb.net/?appName=Cluster0

# ── Firebase Config (Required for document storage & issue tracker) ──
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_APP_ID=1:000000000000:web:xxxxxxxxxxxx

# ── Sandbox API (Optional) ──
SANDBOX_API_URL=
SANDBOX_API_KEY=
EOF
        echo -e "${YELLOW}[CREATED]${NC} .env file created with defaults"
    fi
    echo ""
    echo -e "${RED}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ⚠  ACTION REQUIRED: Configure your .env file          ║${NC}"
    echo -e "${RED}╠══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${RED}║  Open .env in a text editor and add:                    ║${NC}"
    echo -e "${RED}║                                                         ║${NC}"
    echo -e "${RED}║  1. GEMINI_API_KEY  (get from aistudio.google.com)      ║${NC}"
    echo -e "${RED}║  2. MONGO_URI       (get from cloud.mongodb.com)        ║${NC}"
    echo -e "${RED}║  3. VITE_FIREBASE_* (get from Firebase console)         ║${NC}"
    echo -e "${RED}║                                                         ║${NC}"
    echo -e "${RED}║  The application WILL NOT WORK without these keys.      ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════╝${NC}"
else
    echo -e "${GREEN}[OK]${NC} Root .env file already exists"
fi

# Frontend .env (copies Firebase keys from root .env for Vite)
if [ ! -f "frontend/.env" ]; then
    echo -e "${YELLOW}[CREATING]${NC} frontend/.env from root .env..."
    # Extract VITE_ prefixed vars from root .env
    grep "^VITE_" .env > frontend/.env 2>/dev/null
    # Add the local API URL
    echo "VITE_API_URL=http://localhost:8000" >> frontend/.env
    echo -e "${GREEN}[OK]${NC} frontend/.env created with Firebase keys from root .env"
else
    echo -e "${GREEN}[OK]${NC} frontend/.env already exists"
fi

# ══════════════════════════════════════════════════════════
# Step 7: Create required directories & permissions
# ══════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[7/7]${NC} Creating required directories..."
mkdir -p exports _uploads audit_logs
echo -e "${GREEN}[OK]${NC} Directories created (exports, _uploads, audit_logs)"

# Make scripts executable
chmod +x run_backend.sh run_frontend.sh start.sh deploy.sh 2>/dev/null || true
echo -e "${GREEN}[OK]${NC} Scripts made executable"

# ══════════════════════════════════════════════════════════
# Final Summary
# ══════════════════════════════════════════════════════════
echo ""
if [ ${#ERRORS[@]} -gt 0 ]; then
    echo -e "${RED}═══════════════════════════════════════════════════${NC}"
    echo -e "${RED}   Setup Completed with ${#ERRORS[@]} Error(s)${NC}"
    echo -e "${RED}═══════════════════════════════════════════════════${NC}"
    echo ""
    for i in "${!ERRORS[@]}"; do
        echo -e "  ${RED}[$((i+1))]${NC} ${ERRORS[$i]}"
    done
    echo ""
    echo -e "${YELLOW}  Please fix the above errors before running ./start.sh${NC}"
else
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}   ✅ Setup Complete — All Dependencies Installed${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
fi
echo ""
echo -e "  ${CYAN}Next Steps:${NC}"
echo -e "  1. Edit ${BLUE}.env${NC} and add your API keys (GEMINI_API_KEY, MONGO_URI, Firebase)"
echo -e "  2. Run ${BLUE}./start.sh${NC} to launch the application"
echo ""
echo -e "  ${CYAN}Or start servers individually:${NC}"
echo -e "    Backend:  ${BLUE}./run_backend.sh${NC}   (http://localhost:8000)"
echo -e "    Frontend: ${BLUE}./run_frontend.sh${NC}  (http://localhost:5173)"
echo ""
echo -e "  ${CYAN}Troubleshooting:${NC}"
echo -e "    If you see a blank page → Check that ${BLUE}frontend/.env${NC} has VITE_FIREBASE_* keys"
echo -e "    If projects are empty  → Check that ${BLUE}.env${NC} has a valid MONGO_URI"
echo -e "    If extraction fails    → Check that Tesseract OCR is installed (tesseract --version)"
echo ""
