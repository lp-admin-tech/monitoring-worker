"""
Supabase client wrapper with helpers for common operations.
"""

from functools import lru_cache
from typing import Any

from supabase import create_client, Client

from src.config import settings
from src.utils.logger import get_logger

logger = get_logger(__name__)


@lru_cache
def get_supabase_client() -> Client:
    """Get a cached Supabase client instance."""
    return create_client(
        settings.supabase_url,
        settings.supabase_service_key,
    )


class DatabaseClient:
    """
    High-level database client for site monitoring operations.
    Wraps supabase-py with typed methods for our specific tables.
    """
    
    def __init__(self):
        self.client = get_supabase_client()
    
    # ============== Audit Job Queue ==============
    
    async def get_pending_jobs(self, limit: int = 10) -> list[dict[str, Any]]:
        """Get pending audit jobs from the queue."""
        try:
            result = self.client.table("audit_job_queue").select("*").eq(
                "status", "pending"
            ).order("queued_at").limit(limit).execute()
            return result.data
        except Exception as e:
            logger.error("Failed to fetch pending jobs", error=str(e))
            return []
    
    async def claim_job(self, job_id: str) -> bool:
        """Claim a job by setting its status to 'processing'."""
        try:
            from datetime import datetime, timezone
            result = self.client.table("audit_job_queue").update({
                "status": "processing",
                "started_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job_id).eq("status", "pending").execute()
            return len(result.data) > 0
        except Exception as e:
            logger.error("Failed to claim job", job_id=job_id, error=str(e))
            return False
    
    async def complete_job(self, job_id: str, error_message: str | None = None) -> bool:
        """Mark a job as completed or failed."""
        try:
            from datetime import datetime, timezone
            status = "failed" if error_message else "completed"
            update_data = {
                "status": status,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
            if error_message:
                update_data["error_message"] = error_message
            
            result = self.client.table("audit_job_queue").update(
                update_data
            ).eq("id", job_id).execute()
            return len(result.data) > 0
        except Exception as e:
            logger.error("Failed to complete job", job_id=job_id, error=str(e))
            return False
    
    async def recover_stuck_jobs(self, stuck_minutes: int = 30) -> int:
        """
        Reset jobs stuck in 'processing' status for too long.
        
        This handles cases where a worker crashed mid-processing.
        Jobs older than stuck_minutes are reset to 'pending' for retry.
        """
        try:
            from datetime import datetime, timezone, timedelta
            
            cutoff = (
                datetime.now(timezone.utc) - timedelta(minutes=stuck_minutes)
            ).isoformat()
            
            # Find stuck jobs
            stuck_result = self.client.table("audit_job_queue").select("id").eq(
                "status", "processing"
            ).lt("started_at", cutoff).execute()
            
            if not stuck_result.data:
                return 0
            
            stuck_ids = [job["id"] for job in stuck_result.data]
            
            # Reset them to pending
            for job_id in stuck_ids:
                self.client.table("audit_job_queue").update({
                    "status": "pending",
                    "started_at": None,
                    "error_message": f"Reset after stuck for >{stuck_minutes} minutes",
                }).eq("id", job_id).execute()
            
            logger.info(
                "Recovered stuck jobs",
                count=len(stuck_ids),
                stuck_minutes=stuck_minutes,
            )
            return len(stuck_ids)
            
        except Exception as e:
            logger.error("Failed to recover stuck jobs", error=str(e))
            return 0
    
    # ============== Site Audits ==============
    
    async def get_publisher(self, publisher_id: str) -> dict[str, Any] | None:
        """Get publisher by ID."""
        try:
            result = self.client.table("publishers").select("*").eq(
                "id", publisher_id
            ).single().execute()
            return result.data
        except Exception as e:
            logger.error("Failed to fetch publisher", publisher_id=publisher_id, error=str(e))
            return None

    async def create_site_audit(self, publisher_id: str, site_name: str, audit_queue_id: str | None = None, audit_job_queue_id: str | None = None) -> str | None:
        """Create a new site audit record, returns the audit ID."""
        try:
            from datetime import datetime, timezone
            insert_data = {
                "publisher_id": publisher_id,
                "site_name": site_name,
                "status": "pending",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            if audit_queue_id:
                insert_data["audit_queue_id"] = audit_queue_id
            if audit_job_queue_id:
                insert_data["audit_job_queue_id"] = audit_job_queue_id
            
            # Try to insert with links
            try:
                result = self.client.table("site_audits").insert(insert_data).execute()
                return result.data[0]["id"] if result.data else None
            except Exception as e:
                # Check for foreign key violation (Postgres error 23503)
                if "23503" in str(e):
                    logger.warning(
                        "Audit queue job missing, linking skipped",
                        publisher_id=publisher_id,
                        site_name=site_name,
                        audit_queue_id=audit_queue_id,
                        audit_job_queue_id=audit_job_queue_id
                    )
                    # Retry without the failing foreign keys
                    if "audit_queue_id" in insert_data:
                        del insert_data["audit_queue_id"]
                    if "audit_job_queue_id" in insert_data:
                        del insert_data["audit_job_queue_id"]
                        
                    result = self.client.table("site_audits").insert(insert_data).execute()
                    return result.data[0]["id"] if result.data else None
                raise e
        except Exception as e:
            logger.error(
                "Failed to create site audit",
                publisher_id=publisher_id,
                site_name=site_name,
                error=str(e),
            )
            return None
    
    async def update_site_audit(
        self,
        audit_id: str,
        data: dict[str, Any],
    ) -> bool:
        """Update a site audit with results."""
        try:
            self.client.table("site_audits").update(data).eq("id", audit_id).execute()
            return True
        except Exception as e:
            logger.error("Failed to update site audit", audit_id=audit_id, error=str(e))
            return False
    
    async def save_audit_results(
        self,
        audit_id: str,
        risk_score: float,
        mfa_probability: float,
        risk_level: str,
        crawler_data: dict[str, Any],
        content_analysis: dict[str, Any],
        ad_analysis: dict[str, Any],
        technical_check: dict[str, Any],
        policy_check: dict[str, Any],
        ai_report: dict[str, Any] | None = None,
        data_quality_score: float | None = None,
    ) -> bool:
        """Save complete audit results."""
        from datetime import datetime, timezone
        
        return await self.update_site_audit(audit_id, {
            "status": "completed",
            "risk_score": risk_score,
            "mfa_probability": mfa_probability,
            "risk_level": risk_level,
            "crawler_data": crawler_data,
            "content_analysis": content_analysis,
            "ad_analysis": ad_analysis,
            "technical_check": technical_check,
            "policy_check": policy_check,
            "ai_report": ai_report,
            "data_quality_score": data_quality_score,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        })
    
    async def get_publisher_gam_data(
        self,
        publisher_id: str,
        days_back: int = 60,
    ) -> list[dict[str, Any]]:
        """
        Get historical GAM report data for a publisher.
        
        Reads from both tables:
        - reports_dimensional: Daily data for existing publishers
        - report_historical: 2-month backfill for new publishers
        """
        from datetime import datetime, timezone, timedelta
        
        cutoff_date = (
            datetime.now(timezone.utc) - timedelta(days=days_back)
        ).isoformat()
        
        gam_data = []
        
        try:
            # First try reports_dimensional (existing publishers)
            result = self.client.table("reports_dimensional").select("*").eq(
                "publisher_id", publisher_id
            ).gte("report_date", cutoff_date).order("report_date", desc=True).execute()
            
            if result.data:
                gam_data = result.data
                logger.info(
                    "GAM data from reports_dimensional",
                    publisher_id=publisher_id,
                    records=len(gam_data),
                )
            
        except Exception as e:
            logger.warning(
                "Failed to fetch from reports_dimensional",
                publisher_id=publisher_id,
                error=str(e),
            )
        
        # If no data in dimensional, try report_historical (new publishers)
        if not gam_data:
            try:
                result = self.client.table("report_historical").select("*").eq(
                    "publisher_id", publisher_id
                ).gte("date", cutoff_date).order("date", desc=True).execute()
                
                if result.data:
                    gam_data = result.data
                    logger.info(
                        "GAM data from report_historical (new publisher)",
                        publisher_id=publisher_id,
                        records=len(gam_data),
                    )
                    
            except Exception as e:
                logger.warning(
                    "Failed to fetch from report_historical",
                    publisher_id=publisher_id,
                    error=str(e),
                )
        
        if not gam_data:
            logger.info(
                "No GAM data found in either table",
                publisher_id=publisher_id,
            )
        
        return gam_data

    async def get_site_history(
        self,
        publisher_id: str,
        site_name: str,
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        """Get historical audit results for a specific site."""
        try:
            result = self.client.table("site_audits").select(
                "id, risk_score, mfa_probability, risk_level, completed_at"
            ).eq("publisher_id", publisher_id).eq("site_name", site_name).eq(
                "status", "completed"
            ).order("completed_at", desc=True).limit(limit).execute()
            return result.data
        except Exception as e:
            logger.error(
                "Failed to fetch site history",
                publisher_id=publisher_id,
                site_name=site_name,
                error=str(e),
            )
            return []


# Convenience instance
db = DatabaseClient()
