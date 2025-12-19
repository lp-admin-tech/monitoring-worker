"""
Celery application configuration.
"""

from celery import Celery

from src.config import settings

celery_app = Celery(
    "site_monitoring_worker",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["src.queue.tasks"],
)

# Celery configuration
celery_app.conf.update(
    # Task settings
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    
    # Task execution
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_time_limit=600,  # 10 minutes hard limit
    task_soft_time_limit=300,  # 5 minutes soft limit
    
    # Worker settings
    worker_prefetch_multiplier=1,  # One task at a time
    worker_concurrency=3,  # 3 concurrent audits
    
    # Result backend
    result_expires=86400,  # 24 hours
    
    # Retry settings
    task_default_retry_delay=60,
    task_max_retries=3,
)

# Task routes (optional - for scaling)
celery_app.conf.task_routes = {
    "src.queue.tasks.run_site_audit": {"queue": "audits"},
    "src.queue.tasks.poll_queue": {"queue": "default"},
    "src.queue.tasks.recover_stuck_jobs": {"queue": "default"},
}

# Celery Beat schedule (cron tasks)
celery_app.conf.beat_schedule = {
    # Poll audit job queue every minute
    "poll-audit-queue": {
        "task": "src.queue.tasks.poll_queue",
        "schedule": 60.0,  # Every minute
    },
    # Recover stuck jobs every 10 minutes
    "recover-stuck-jobs": {
        "task": "src.queue.tasks.recover_stuck_jobs",
        "schedule": 600.0,  # Every 10 minutes
    },
    # NOTE: Alert rule evaluation moved to Edge Function + pg_cron
}
