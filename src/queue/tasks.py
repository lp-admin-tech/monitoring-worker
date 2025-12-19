"""
Celery tasks for site monitoring.
"""

import asyncio
import time
from typing import Any

from celery import shared_task

from src.utils.logger import get_logger

logger = get_logger(__name__)

# Multi-URL crawling configuration
MULTI_URL_ENABLED = True
MAX_URLS_PER_AUDIT = 25  # Full site audit (homepage + priority pages + samples)
INCLUDE_MFA_PATHS = True  # Prioritize /health/, /insurance/, /amp/, etc.

# Critical pages that MUST be attempted (policy validation)
CRITICAL_PAGES = [
    "/privacy", "/privacy-policy",
    "/terms", "/terms-of-service", "/tos",
    "/about", "/about-us",
    "/contact", "/contact-us",
]


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def run_site_audit(
    self,
    publisher_id: str,
    site_url: str | None = None,
    site_name: str | None = None,
    priority: str = "normal",
    triggered_by: str = "api",
) -> dict[str, Any]:
    """
    Run a complete site audit.
    
    This is the main Celery task that orchestrates the entire audit flow:
    1. Crawl the site using crawl4ai
    2. Run all analyzers (content, ads, technical, policy)
    3. Calculate risk scores
    4. Generate AI report
    5. Save results to database
    """
    logger.info(
        "Starting site audit",
        task_id=self.request.id,
        publisher_id=publisher_id,
        site_url=site_url,
        triggered_by=triggered_by,
    )
    
    try:
        # Run the async audit flow in an event loop
        result = asyncio.run(
            _run_audit_async(
                publisher_id=publisher_id,
                site_url=site_url,
                site_name=site_name,
                triggered_by=triggered_by,
            )
        )
        
        logger.info(
            "Site audit completed",
            task_id=self.request.id,
            publisher_id=publisher_id,
            risk_score=result.get("risk_score"),
        )
        
        return result
        
    except Exception as e:
        logger.error(
            "Site audit failed",
            task_id=self.request.id,
            publisher_id=publisher_id,
            error=str(e),
        )
        # Retry on failure
        raise self.retry(exc=e)


async def _run_audit_async(
    publisher_id: str,
    site_url: str | None,
    site_name: str | None,
    triggered_by: str,
) -> dict[str, Any]:
    """Async implementation of the full audit flow."""
    from src.database.client import db
    from src.crawlers.audit_crawler import AuditCrawler
    from src.crawlers.network_interceptor import NetworkInterceptor
    from src.analyzers.content_analyzer import ContentAnalyzer
    from src.analyzers.ad_analyzer import AdAnalyzer
    from src.analyzers.technical_checker import TechnicalChecker
    from src.analyzers.policy_checker import PolicyChecker
    from src.analyzers.directory_detector import DirectoryDetector
    from src.scoring.risk_engine import RiskEngine
    from src.scoring.trend_analyzer import TrendAnalyzer
    from src.ai.llm_client import LLMClient
    from src.services.audit_target_builder import AuditTargetBuilder
    
    # Get publisher info
    publisher = await db.get_publisher(publisher_id)
    if not publisher:
        raise ValueError(f"Publisher not found: {publisher_id}")
    
    # Determine the URL to crawl
    url = site_url or publisher.get("site_url") or f"https://{site_name}"
    site = site_name or publisher.get("site_name") or url
    
    # Create audit record
    audit_id = await db.create_site_audit(publisher_id, site)
    if not audit_id:
        raise ValueError("Failed to create audit record")
    
    try:
        # Step 1: Crawl the site (multi-URL for comprehensive analysis)
        logger.info("="*60)
        logger.info("STEP 1: CRAWLING SITE", url=url, audit_id=audit_id, multi_url=MULTI_URL_ENABLED)
        logger.info("="*60)
        start_time = time.perf_counter()
        crawler = AuditCrawler()
        
        if MULTI_URL_ENABLED:
            crawl_results = await crawler.crawl_multi(
                url,
                max_urls=MAX_URLS_PER_AUDIT,
                include_mfa_paths=INCLUDE_MFA_PATHS,
            )
            crawl_result = crawl_results[0]  # Primary page for backwards compatibility
            aggregated = crawler.aggregate_results(crawl_results)
            logger.info(
                "✓ Multi-URL crawl complete",
                pages_crawled=len(crawl_results),
                successful=[r.url for r in crawl_results if not r.error],
            )
        else:
            crawl_result = await crawler.crawl(url)
            crawl_results = [crawl_result]
            aggregated = {}
        
        duration = time.perf_counter() - start_time
        logger.info(
            "✓ Crawl complete",
            duration_s=f"{duration:.2f}s",
            load_time_ms=crawl_result.load_time_ms,
            requests=len(crawl_result.requests),
            ad_elements=len(crawl_result.ad_elements),
            has_screenshot=crawl_result.screenshot_base64 is not None,
        )
        
        if crawl_result.error:
            logger.warning("⚠ Crawl had errors", error=crawl_result.error)
        
        # Step 2: Analyze network requests
        logger.info("="*60)
        logger.info("STEP 2: ANALYZING NETWORK REQUESTS", total_requests=len(crawl_result.requests))
        logger.info("="*60)
        start_time = time.perf_counter()
        network_interceptor = NetworkInterceptor()
        network_analysis = network_interceptor.analyze_requests(crawl_result.requests)
        duration = time.perf_counter() - start_time
        logger.info(
            "✓ Network analysis complete",
            duration_s=f"{duration:.2f}s",
            ad_requests=network_analysis.get("ad_requests_count", 0),
            networks_detected=len(network_analysis.get("detected_networks", [])),
        )
        
        # Step 3: Run all analyzers in parallel
        logger.info("="*60)
        logger.info("STEP 3: RUNNING ANALYZERS (Parallel)")
        logger.info("Analyzers: Content, Ads, Technical, Policy, Directory")
        logger.info("="*60)
        start_time = time.perf_counter()
        
        content_analyzer = ContentAnalyzer()
        ad_analyzer = AdAnalyzer()
        technical_checker = TechnicalChecker()
        policy_checker = PolicyChecker()
        directory_detector = DirectoryDetector()
        
        # Import domain health checker for Phase B checks
        from src.analyzers.domain_health import DomainHealthChecker
        domain_health_checker = DomainHealthChecker()
        
        (
            content_result,
            ad_result,
            technical_result,
            policy_result,
            directory_result,
            domain_health_result,
        ) = await asyncio.gather(
            content_analyzer.analyze(crawl_result),
            ad_analyzer.analyze(crawl_result),
            technical_checker.check(url, crawl_result),
            policy_checker.check(
                url, 
                crawl_result.text, 
                crawl_result.title, 
                crawl_result.policy_pages,
                policy_contents=aggregated.get("policy_contents", {}) if aggregated else {}
            ),
            asyncio.to_thread(
                directory_detector.detect,
                url,
                crawl_result.html,
                crawl_result.title,
                crawl_result.text,
            ),
            domain_health_checker.check_all(url),
        )
        duration = time.perf_counter() - start_time
        
        logger.info(
            "✓ All analyzers complete",
            duration_s=f"{duration:.2f}s",
            content_quality=content_result.get("quality_score", 0),
            ad_density=ad_result.get("ad_density", 0),
            policy_violations=len(policy_result.get("violations", [])),
            is_directory=directory_result.get("is_directory", False),
            domain_health=domain_health_result.get("health_score", 0),
        )
        
        # Merge domain health into technical result for database storage
        technical_result["domain_health"] = domain_health_result
        technical_result["dns"] = domain_health_result.get("dns", {})
        technical_result["safe_browsing"] = domain_health_result.get("safe_browsing", {})
        technical_result["pagespeed"] = domain_health_result.get("pagespeed", {})
        
        # Merge network analysis into ad_result
        ad_result["network_analysis"] = network_analysis
        ad_result["ad_request_count"] = network_analysis.get("ad_requests_count", 0)
        
        # Merge multi-URL aggregated metrics into ad_result
        if aggregated:
            ad_result["multi_page_metrics"] = aggregated
            ad_result["pages_crawled"] = aggregated.get("total_pages_crawled", 1)
            ad_result["avg_ads_per_page"] = aggregated.get("avg_ads_per_page", 0)
            ad_result["template_reuse_detected"] = aggregated.get("template_reuse_detected", False)
            logger.info(
                "✓ Multi-page aggregation complete",
                pages=aggregated.get("total_pages_crawled"),
                avg_ads=aggregated.get("avg_ads_per_page"),
                template_reuse=aggregated.get("template_reuse_detected"),
            )
        
        # Step 4: Calculate risk score
        logger.info("="*60)
        logger.info("STEP 4: CALCULATING MFA RISK SCORE")
        logger.info("="*60)
        start_time = time.perf_counter()
        risk_engine = RiskEngine()
        
        # Get GAM data for correlation
        logger.info("Fetching GAM data for correlation...")
        gam_data = await db.get_publisher_gam_data(publisher_id)
        logger.info("GAM data loaded", records=len(gam_data) if gam_data else 0)
        
        # Compute GAM deception flags
        target_builder = AuditTargetBuilder(gam_data=gam_data)
        gam_flags = target_builder.compute_mfa_flags()
        if gam_flags.get("has_data"):
            logger.info(
                "✓ GAM deception flags computed",
                mfa_classic=gam_flags.get("mfa_classic"),
                clickbait_signal=gam_flags.get("clickbait_signal"),
                low_quality_signal=gam_flags.get("low_quality_signal"),
                gam_risk_level=gam_flags.get("gam_risk_level"),
            )
            # Pass GAM flags to ad_result for risk scoring
            ad_result["gam_flags"] = gam_flags
            ad_result["mfa_classic_signal"] = gam_flags.get("mfa_classic", False)
            ad_result["clickbait_signal"] = gam_flags.get("clickbait_signal", False)
        
        # Analyze traffic quality from GAM dimensional data
        from src.analyzers.traffic_quality import TrafficQualityAnalyzer
        traffic_analyzer = TrafficQualityAnalyzer(gam_data=gam_data)
        traffic_quality = traffic_analyzer.analyze()
        if traffic_quality.get("has_data"):
            logger.info(
                "✓ Traffic quality analysis complete",
                score=traffic_quality.get("traffic_quality_score"),
                tier1_pct=traffic_quality.get("geographic", {}).get("tier1_percentage", 0),
                social_pct=traffic_quality.get("traffic_sources", {}).get("social_traffic_percentage", 0),
                arbitrage_signal=traffic_quality.get("arbitrage_traffic_signal"),
            )
            # Add traffic quality signals to ad_result for risk scoring
            ad_result["traffic_quality"] = traffic_quality
            ad_result["traffic_quality_score"] = traffic_quality.get("traffic_quality_score", 50)
            ad_result["arbitrage_traffic_signal"] = traffic_quality.get("arbitrage_traffic_signal", False)
            ad_result["low_tier_traffic_signal"] = traffic_quality.get("low_tier_traffic_signal", False)
            ad_result["invalid_traffic_signal"] = traffic_quality.get("invalid_traffic_signal", False)
            ad_result["low_ecpm_signal"] = traffic_quality.get("low_ecpm_signal", False)
        
        risk_result = risk_engine.calculate_score(
            content_analysis=content_result,
            ad_analysis=ad_result,
            technical_check=technical_result,
            policy_check=policy_result,
            gam_data=gam_data,
        )
        duration = time.perf_counter() - start_time
        
        logger.info(
            "✓ Risk score calculated",
            duration_s=f"{duration:.2f}s",
            risk_score=risk_result["risk_score"],
            mfa_probability=risk_result["mfa_probability"],
            risk_level=risk_result["risk_level"],
        )
        
        # Step 5: Analyze trends (get previous audits)
        logger.info("Analyzing trends", audit_id=audit_id)
        trend_analyzer = TrendAnalyzer()
        historical_audits = await db.get_site_history(publisher_id, site)
        trend_result = trend_analyzer.analyze_trends(
            current_audit=risk_result,
            historical_audits=historical_audits,
        )
        logger.info(
            "✓ Trend analysis complete",
            has_history=trend_result["has_history"],
            direction=trend_result.get("trend_direction"),
            change_rate=f"{trend_result.get('change_rate', 0):+.1f}%",
        )
        
        # Step 6: Generate AI report
        logger.info("="*60)
        logger.info("STEP 5: GENERATING AI ANALYSIS REPORT")
        logger.info("="*60)
        start_time = time.perf_counter()
        llm_client = LLMClient()
        
        ai_report = await llm_client.generate_report(
            audit_data={
                "content_analysis": content_result,
                "ad_analysis": ad_result,
                "technical_check": technical_result,
                "policy_check": policy_result,
            },
            risk_score=risk_result["risk_score"],
            risk_level=risk_result["risk_level"],
        )
        duration = time.perf_counter() - start_time
        
        logger.info(
            "✓ AI report generated",
            duration_s=f"{duration:.2f}s",
            summary_length=len(ai_report.get("summary", "")),
        )
        
        # Step 7: Save results
        logger.info("="*60)
        logger.info("STEP 6: SAVING AUDIT RESULTS TO DATABASE")
        logger.info("="*60)
        start_time = time.perf_counter()
        await db.save_audit_results(
            audit_id=audit_id,
            risk_score=risk_result["risk_score"],
            mfa_probability=risk_result["mfa_probability"],
            risk_level=risk_result["risk_level"],
            crawler_data={
                "url": url,
                "title": crawl_result.title,
                "load_time_ms": crawl_result.load_time_ms,
                "total_requests": len(crawl_result.requests),
                "ad_elements_count": len(crawl_result.ad_elements),
                "has_screenshot": crawl_result.screenshot_base64 is not None,
                # Multi-URL metrics
                "pages_crawled": len(crawl_results),
                "aggregated_metrics": aggregated if aggregated else None,
            },
            content_analysis=content_result,
            ad_analysis=ad_result,
            technical_check=technical_result,
            policy_check=policy_result,
            ai_report=ai_report,
            data_quality_score=risk_result.get("data_quality_score"),
        )
        duration = time.perf_counter() - start_time
        logger.info("✓ Audit results saved to database", duration_s=f"{duration:.2f}s")
        
        # Update with directory status
        if directory_result.get("is_directory"):
            await db.update_site_audit(audit_id, {
                "is_directory": True,
                "directory_type": directory_result.get("directory_type"),
            })
        
        # Step 8: Create alerts based on results
        logger.info("="*60)
        logger.info("STEP 7: CHECKING ALERT THRESHOLDS")
        logger.info("="*60)
        from src.services.alert_service import alert_service
        
        alert_data = {
            "mfa_probability": risk_result["mfa_probability"],
            "ivt_analysis": ad_result.get("network_analysis", {}),
            "policy_check": policy_result,
            "gam_analysis": {"metrics": gam_data} if gam_data else {},
            "arbitrage_analysis": {},  # TODO: Add traffic arbitrage analysis
        }
        
        created_alerts = await alert_service.check_and_create_alerts(
            publisher_id=publisher_id,
            audit_result=alert_data,
        )
        
        if created_alerts:
            logger.info(
                "✓ Alerts created",
                alert_count=len(created_alerts),
                alert_types=[a.get("alert_type") for a in created_alerts],
            )
        else:
            logger.info("✓ No alerts triggered - all metrics within acceptable ranges")
        
        logger.info("="*60)
        logger.info("✅ AUDIT COMPLETE")
        logger.info(
            "Final Results",
            audit_id=audit_id,
            risk_score=f"{risk_result['risk_score']:.2f}",
            risk_level=risk_result["risk_level"],
            mfa_probability=f"{risk_result['mfa_probability']:.1%}",
        )
        logger.info("="*60)
        
        return {
            "audit_id": audit_id,
            "publisher_id": publisher_id,
            "site_url": url,
            "risk_score": risk_result["risk_score"],
            "mfa_probability": risk_result["mfa_probability"],
            "risk_level": risk_result["risk_level"],
            "is_directory": directory_result.get("is_directory", False),
            "ai_summary": ai_report.get("summary", ""),
            "status": "completed",
        }
        
    except Exception as e:
        # Mark audit as failed
        await db.update_site_audit(audit_id, {
            "status": "failed",
            "error_message": str(e),
        })
        raise


@shared_task
def poll_queue() -> dict[str, Any]:
    """
    Poll the Supabase audit_job_queue and dispatch tasks.
    This is called periodically by Celery Beat.
    """
    logger.info("Polling audit job queue")
    
    result = asyncio.run(_poll_queue_async())
    return result


async def _poll_queue_async() -> dict[str, Any]:
    """Async queue polling implementation."""
    from src.database.client import db
    
    jobs = await db.get_pending_jobs(limit=5)
    dispatched = 0
    
    for job in jobs:
        job_id = job["id"]
        publisher_id = job["publisher_id"]
        sites = job.get("sites", [])
        triggered_by = job.get("triggered_by", "scheduled")
        
        # Claim the job
        if not await db.claim_job(job_id):
            continue
        
        # Dispatch audit tasks for each site
        for site_info in sites:
            # Handle both string and dict formats
            if isinstance(site_info, str):
                site_name = site_info
                site_url = None
            else:
                site_name = site_info.get("site_name")
                site_url = site_info.get("url") or site_info.get("site_url")
            
            run_site_audit.delay(
                publisher_id=publisher_id,
                site_url=site_url,
                site_name=site_name,
                triggered_by=triggered_by,
            )
            dispatched += 1
        
        # Mark job as completed (individual audit results are tracked separately)
        await db.complete_job(job_id)
    
    logger.info("Queue poll completed", jobs_found=len(jobs), tasks_dispatched=dispatched)
    return {"jobs_processed": len(jobs), "tasks_dispatched": dispatched}


@shared_task
def recover_stuck_jobs() -> dict[str, Any]:
    """
    Recover jobs stuck in 'processing' state for too long.
    
    This task should be scheduled to run every 10-15 minutes via Celery Beat.
    It resets stuck jobs back to 'pending' so they can be retried.
    """
    logger.info("Running stuck job recovery")
    result = asyncio.run(_recover_jobs_async())
    return result


async def _recover_jobs_async() -> dict[str, Any]:
    """Async implementation of job recovery."""
    from src.database.client import db
    
    recovered = await db.recover_stuck_jobs(stuck_minutes=30)
    
    return {"recovered_jobs": recovered}


# NOTE: Alert rule evaluation was moved to Supabase Edge Function (evaluate-alert-rules)
# The pg_cron job in database calls the Edge Function hourly.
