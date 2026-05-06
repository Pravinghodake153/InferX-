#!/bin/bash

# InferX Unified Deployment Script
# This script deploys the application to GitHub, Vercel, and Hugging Face in one go.

# 1. Load environment variables from .env
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
else
    echo "❌ Error: .env file not found!"
    exit 1
fi

echo "🚀 Starting Unified Deployment for InferX..."

# 2. Push to GitHub
echo "📂 [1/3] Pushing to GitHub..."
git add .
git commit -m "chore: deployment sync $(date +'%Y-%m-%d %H:%M:%S')"
git push origin main
if [ $? -eq 0 ]; then
    echo "✅ GitHub Push Successful"
else
    echo "⚠️ GitHub Push Failed (Continuing...)"
fi

# 3. Deploy to Vercel
echo "🌐 [2/3] Deploying Frontend to Vercel..."
if [ -z "$VERCEL_TOKEN" ]; then
    echo "❌ Error: VERCEL_TOKEN not found in .env"
else
    cd frontend && npx vercel --prod --token "$VERCEL_TOKEN" --yes && cd ..
    if [ $? -eq 0 ]; then
        echo "✅ Vercel Deployment Successful"
    else
        echo "❌ Vercel Deployment Failed"
    fi
fi

# 4. Deploy to Hugging Face
echo "🤗 [3/3] Deploying Backend to Hugging Face Spaces..."
if [ -z "$HUGGING_FACE_TOKEN" ]; then
    echo "❌ Error: HUGGING_FACE_TOKEN not found in .env"
else
    # Use the venv python if available, otherwise fallback to python3
    if [ -f "./venv/bin/python" ]; then
        ./venv/bin/python hf_deploy.py
    else
        python3 hf_deploy.py
    fi

    if [ $? -eq 0 ]; then
        echo "✅ Hugging Face Deployment Successful"
    else
        echo "❌ Hugging Face Deployment Failed"
    fi
fi

echo "✨ All deployment tasks completed!"
