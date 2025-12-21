import asyncio
import sys
import os

# Add src to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.queue.tasks import _run_audit_async
from src.utils.logger import get_logger

logger = get_logger(__name__)

async def test_audit():
    publisher_id = "3d395b2e-f0b0-4f4f-9dcd-1ebf16e02fce"
    site_url = "https://box10.site"
    site_name = "box10.site"
    
    logger.info("Starting local test audit", site_url=site_url)
    
    try:
        result = await _run_audit_async(
            publisher_id=publisher_id,
            site_url=site_url,
            site_name=site_name,
            triggered_by="local_test"
        )
        
        logger.info("Audit complete", risk_score=result.get("risk_score"))
        
        # Check for new signals in the result
        technical = result.get("technical_check", {})
        policy = result.get("policy_check", {})
        ad_analysis = result.get("ad_analysis", {})
        
        logger.info("Checking signals...")
        logger.info("DNS:", dns=technical.get("dns"))
        logger.info("Safe Browsing:", safe_browsing=technical.get("safe_browsing"))
        logger.info("Broken Links:", broken_links=technical.get("broken_links"))
        logger.info("Policy Validation:", policy_validation=policy.get("content_validation"))
        logger.info("eCPM Analysis:", ecpm_analysis=ad_analysis.get("traffic_quality", {}).get("ecpm_analysis"))
        
    except Exception as e:
        logger.error("Audit failed", error=str(e))

if __name__ == "__main__":
    asyncio.run(test_audit())
