FROM python:3.12-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/app/pw-browsers

# Install system dependencies for Playwright and health checks
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    curl \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir uv && \
    uv pip install --system .

# Install Playwright browsers to a specific path
RUN playwright install chromium

# Copy application code
COPY . .

# Create a start script to handle different roles
RUN echo '#!/bin/bash\n\
    if [ "$ROLE" = "worker" ]; then\n\
    exec celery -A src.queue.celery_app worker --loglevel=info --concurrency=${CONCURRENCY:-2}\n\
    elif [ "$ROLE" = "beat" ]; then\n\
    exec celery -A src.queue.celery_app beat --loglevel=info\n\
    else\n\
    exec uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8000}\n\
    fi' > /app/start.sh && chmod +x /app/start.sh

# Expose port for FastAPI
EXPOSE 8000

# Health check (only relevant for API role)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/health || exit 1

# Default command
CMD ["/app/start.sh"]
