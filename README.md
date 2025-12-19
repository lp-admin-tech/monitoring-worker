# Site Monitoring Worker - Python Edition

MFA (Made For Advertising) detection worker rebuilt in Python using crawl4ai, FastAPI, and Celery.

## Quick Start

```bash
# Install dependencies
pip install -e ".[dev]"

# Install Playwright browsers
playwright install chromium

# Start Redis (required for Celery)
docker run -d -p 6379:6379 redis:alpine

# Run the API server
uvicorn src.main:app --reload --port 8000

# Run the Celery worker (in another terminal)
celery -A src.queue.celery_app worker -l info
```

## Project Structure

```
src/
├── api/           # FastAPI endpoints
├── crawlers/      # Crawl4AI-based crawling
├── analyzers/     # Content, ads, technical analysis
├── scoring/       # MFA risk scoring engine
├── ai/            # LLM report generation
├── database/      # Supabase client
├── queue/         # Celery tasks
└── utils/         # Logging, validators
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
GROQ_API_KEY=your_groq_key
REDIS_URL=redis://localhost:6379/0
```
