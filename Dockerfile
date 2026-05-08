# Stage 1: Build React Frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend

# Copy frontend source
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./

# Inject Hugging Face dummy API URL (optional, defaults to relative /api)
ENV VITE_API_URL=""
RUN npm run build


# Stage 2: Build FastAPI Backend
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies (required for OCR/Computer Vision)
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    tesseract-ocr \
    tesseract-ocr-hin \
    libtesseract-dev \
    ghostscript \
    python3-tk \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY ./app ./app

# Set up public directory for static files
RUN mkdir -p public/assets public/images

# Copy built frontend assets from Stage 1 into the Python backend's public directory
COPY --from=frontend-builder /app/frontend/dist/index.html public/
COPY --from=frontend-builder /app/frontend/dist/assets/* public/assets/

# Fix permissions for Hugging Face Spaces (Spaces run as non-root user '1000')
RUN useradd -m -u 1000 user
RUN chown -R user:user /app
USER user

# Hugging Face Spaces strictly requires exposing port 7860
EXPOSE 7860

# Start Uvicorn bound to 0.0.0.0 and port 7860
CMD ["uvicorn", "app.api:app", "--host", "0.0.0.0", "--port", "7860"]
