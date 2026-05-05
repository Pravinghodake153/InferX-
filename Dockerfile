# Backend Dockerfile for InferX
FROM python:3.11-slim

# Install system dependencies required for OpenCV/PaddleOCR/Tesseract/Camelot
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    tesseract-ocr \
    tesseract-ocr-hin \
    libtesseract-dev \
    ghostscript \
    python3-tk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY ./app ./app
RUN mkdir -p public/images

# Expose FastAPI port (Hugging Face Spaces requires 7860)
EXPOSE 7860

# Start Uvicorn
CMD ["uvicorn", "app.api:app", "--host", "0.0.0.0", "--port", "7860"]
