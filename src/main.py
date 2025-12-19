"""
FastAPI application entry point.
Provides health endpoints and API for triggering audits.
"""

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from src.config import settings
from src.utils.logger import get_logger

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - startup and shutdown."""
    logger.info("Starting Site Monitoring Worker", version="1.0.0")
    yield
    logger.info("Shutting down Site Monitoring Worker")


app = FastAPI(
    title="Site Monitoring Worker",
    description="MFA Detection Site Monitoring Worker - Python Edition",
    version="1.0.0",
    lifespan=lifespan,
)


# ============== Health Endpoints ==============

@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint for container orchestration."""
    return {"status": "healthy"}


@app.get("/ready")
async def readiness_check() -> dict[str, Any]:
    """Readiness check - verifies all dependencies are available."""
    checks = {
        "supabase": False,
        "redis": False,
    }
    
    # Check Supabase connection
    try:
        from src.database.client import get_supabase_client
        client = get_supabase_client()
        # Simple query to verify connection
        checks["supabase"] = True
    except Exception as e:
        logger.warning("Supabase health check failed", error=str(e))
    
    # Check Redis connection
    try:
        import redis
        r = redis.from_url(settings.redis_url)
        r.ping()
        checks["redis"] = True
    except Exception as e:
        logger.warning("Redis health check failed", error=str(e))
    
    all_healthy = all(checks.values())
    return {
        "status": "ready" if all_healthy else "degraded",
        "checks": checks,
    }


# ============== Audit API ==============

class AuditRequest(BaseModel):
    """Request model for triggering an audit."""
    publisher_id: str
    site_url: str | None = None
    site_name: str | None = None
    priority: str = "normal"
    triggered_by: str = "api"


class AuditResponse(BaseModel):
    """Response model for audit trigger."""
    task_id: str
    status: str
    message: str


@app.post("/audit", response_model=AuditResponse)
async def trigger_audit(request: AuditRequest) -> AuditResponse:
    """Trigger a site audit via Celery task."""
    try:
        from src.queue.tasks import run_site_audit
        
        # Dispatch the audit task
        task = run_site_audit.delay(
            publisher_id=request.publisher_id,
            site_url=request.site_url,
            site_name=request.site_name,
            priority=request.priority,
            triggered_by=request.triggered_by,
        )
        
        logger.info(
            "Audit task dispatched",
            task_id=task.id,
            publisher_id=request.publisher_id,
        )
        
        return AuditResponse(
            task_id=task.id,
            status="queued",
            message=f"Audit queued for publisher {request.publisher_id}",
        )
    except Exception as e:
        logger.error("Failed to dispatch audit task", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/audit/{task_id}")
async def get_audit_status(task_id: str) -> dict[str, Any]:
    """Get the status of an audit task."""
    try:
        from src.queue.celery_app import celery_app
        
        result = celery_app.AsyncResult(task_id)
        
        return {
            "task_id": task_id,
            "status": result.status,
            "result": result.result if result.ready() else None,
        }
    except Exception as e:
        logger.error("Failed to get task status", task_id=task_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


def run_server():
    """Run the FastAPI server (for CLI entry point)."""
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    run_server()
