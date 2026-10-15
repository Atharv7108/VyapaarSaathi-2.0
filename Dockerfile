# Stage 1: Build the frontend SPA
FROM node:20-slim AS frontend-builder
WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY frontend/ ./frontend/
COPY vite.config.js postcss.config.cjs tailwind.config.cjs tsconfig.json ./
RUN npm run build

# Stage 2: Python Backend runtime with FFmpeg
FROM python:3.11-slim

# Prevent Python from writing .pyc files and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

# Install system dependencies (FFmpeg is required for WhatsApp audio conversion, curl for health checks)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY . .

# Copy built frontend assets from builder stage into /app/web
COPY --from=frontend-builder /build/web /app/web

# Expose container port
EXPOSE 8000

# Start Uvicorn bound to 0.0.0.0 and dynamic $PORT (passed by Render, Koyeb, etc.)
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
