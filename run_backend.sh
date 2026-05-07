#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  InferX Document AI — Backend Server
#  Launches FastAPI on port 8000
# ═══════════════════════════════════════════════════════════════

# Resolve script directory (works even if called from another path)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting InferX Backend Server on port 8000..."

# Activate virtual environment
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
else
    echo "[ERROR] Virtual environment not found at venv/"
    echo "  Run ./setup.sh first to create it."
    exit 1
fi

# Use the venv's uvicorn directly to avoid PATH issues
if [ -f "venv/bin/uvicorn" ]; then
    venv/bin/uvicorn app.api:app --reload --port 8000
else
    echo "[ERROR] uvicorn not found in virtual environment."
    echo "  Run: source venv/bin/activate && pip install uvicorn"
    exit 1
fi
