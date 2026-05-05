#!/bin/bash
echo "Starting InferX Backend Server on port 8000..."
source venv/bin/activate
uvicorn app.api:app --reload --port 8000
