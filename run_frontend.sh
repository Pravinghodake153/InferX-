#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  InferX Document AI — Frontend Server
#  Launches Vite dev server on port 5173
# ═══════════════════════════════════════════════════════════════

# Resolve script directory (works even if called from another path)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting InferX Frontend Server on port 5173..."

if [ ! -d "frontend/node_modules" ]; then
    echo "[WARNING] node_modules not found. Installing dependencies..."
    cd frontend
    npm install 2>&1 | tail -5
    cd ..
fi

cd frontend
npm run dev
