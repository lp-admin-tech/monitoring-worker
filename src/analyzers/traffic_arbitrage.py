"""
Traffic Arbitrage Detector - Detects traffic arbitrage patterns.
Industry-standard implementation aligned with Pixalate methodology.
"""

from typing import Any
from datetime import datetime, timedelta, timezone
import re

from src.utils.logger import get_logger
from src.crawlers.audit_crawler import CrawlResult

logger = get_logger(__name__)


class TrafficArbitrageDetector:
    """
    Detects traffic arbitrage patterns (Pixalate methodology).
    
    Traffic arbitrage = buying cheap traffic (social, native ads)
    to monetize with display ads. Key MFA indicator.
    """
    
    # Known traffic arbitrage sources
    ARBITRAGE_SOURCES = [
        "taboola", "outbrain", "mgid", "revcontent", "zergnet", "content.ad",
        "adblade", "ligatus", "plista", "triplelift", "sharethrough",
        "popads", "popunder", "exoclick", "propellerads", "adsterra",
        "facebook.com/l.php", "t.co/", "lnkd.in/", "bit.ly", "tinyurl.com",
        "g00.gl", "ow.ly", "t.me", "whatsapp.com",
    ]
    
    REDIRECT_PATTERNS = [
        r"/go/", r"/out/", r"/visit/", r"/click/", r"/refer/", r"/track/",
        r"/hop/", r"/jump/", r"/redir/", r"/link/", r"/away/",
        r"\?utm_source=(fb|ig|tw|li|wa|tg)",
        r"\?gclid=", r"\?fbclid=", r"\?msclkid=",
    ]

    def __init__(self):
        self.thresholds = {
            "ctr_spike": 2.0,         # 2x above average = suspicious
            "ecpm_drop": 0.5,         # eCPM drop of 50% = arbitrage sign
            "impression_spike": 3.0,  # 3x spike = possible bought traffic
        }
    
    async def analyze(self, crawl_result: CrawlResult, gam_data: list[dict[str, Any]] = None) -> dict[str, Any]:
        """Analyze traffic arbitrage patterns."""
        logger.info("Analyzing traffic arbitrage", url=crawl_result.url)
        
        # 1. Analyze crawl data for arbitrage indicators
        crawl_indicators = self._analyze_crawl_data(crawl_result)
        
        # 2. Detect social cloaking
        social_cloaking = self._detect_social_cloaking(crawl_result)
        
        # 3. Analyze GAM data if available
        gam_indicators = self._analyze_gam_data(gam_data) if gam_data else {}
        
        # Combine risk scores
        risk_score = self._combine_risk_scores(crawl_indicators, gam_indicators, social_cloaking)
        
        return {
            "crawl_indicators": crawl_indicators,
            "social_cloaking": social_cloaking,
            "gam_indicators": gam_indicators,
            "risk_score": round(risk_score, 2),
            "risk_level": self._get_risk_level(risk_score),
            "is_arbitrage_likely": risk_score > 0.6,
        }

    def _analyze_crawl_data(self, crawl_result: CrawlResult) -> dict[str, Any]:
        """Analyze crawl data for arbitrage signals."""
        network_requests = crawl_result.requests or []
        url = crawl_result.url or ""
        
        # Detect arbitrage sources in network requests
        arbitrage_requests = []
        for req in network_requests:
            req_url = req.get("url", "").lower()
            for source in self.ARBITRAGE_SOURCES:
                if source in req_url:
                    arbitrage_requests.append({
                        "url": req_url[:100],
                        "source": source,
                    })
                    break
        
        # Check for arbitrage tracking parameters in URL
        url_signals = []
        for pattern in self.REDIRECT_PATTERNS:
            if re.search(pattern, url, re.IGNORECASE):
                url_signals.append(pattern)
        
        # Detect native widgets
        native_widgets = crawl_result.native_widgets or []
        
        risk_score = 0.0
        if len(arbitrage_requests) > 5: risk_score += 0.3
        if url_signals: risk_score += 0.2
        if native_widgets: risk_score += 0.3
        
        return {
            "arbitrage_request_count": len(arbitrage_requests),
            "url_signals": url_signals,
            "native_widget_count": len(native_widgets),
            "risk_score": min(risk_score, 1.0)
        }

    def _detect_social_cloaking(self, crawl_result: CrawlResult) -> dict[str, Any]:
        """Detect signs of social media cloaking (different content for social bots)."""
        html = crawl_result.html or ""
        patterns = []
        
        # 1. Check for social-specific meta tags that might be used for cloaking
        if "fb:app_id" in html and "og:title" not in html:
            patterns.append("suspicious_social_meta")
            
        # 2. Check for scripts that detect social referrers
        social_detect_scripts = ["document.referrer", "facebook.com", "t.co", "instagram.com"]
        for script in crawl_result.scripts:
            for social in social_detect_scripts:
                if social in script.lower():
                    patterns.append(f"social_referrer_detection: {social}")
                    
        # 3. Check for UTM parameters in internal links (often used in arbitrage loops)
        utm_count = 0
        for link in crawl_result.links:
            href = link.get("href", "").lower()
            if "utm_source=" in href and ("fb" in href or "social" in href):
                utm_count += 1
        
        if utm_count > 3:
            patterns.append(f"excessive_internal_utm: {utm_count}")
            
        return {
            "detected": len(patterns) > 0,
            "patterns": patterns,
            "score": min(len(patterns) * 0.25, 1.0)
        }

    def _analyze_gam_data(self, gam_data: list[dict[str, Any]]) -> dict[str, Any]:
        """Analyze GAM historical data for arbitrage patterns."""
        if not gam_data:
            return {"risk_score": 0}
            
        # Simplified: check for CTR spikes
        ctrs = [float(r.get("clicks", 0)) / max(float(r.get("impressions", 1)), 1) for r in gam_data]
        if not ctrs:
            return {"risk_score": 0}
            
        avg_ctr = sum(ctrs) / len(ctrs)
        max_ctr = max(ctrs)
        
        risk_score = 0.0
        if avg_ctr > 0.05: risk_score += 0.4  # High overall CTR
        if max_ctr > avg_ctr * 3: risk_score += 0.3  # Significant spike
        
        return {
            "avg_ctr": round(avg_ctr, 4),
            "max_ctr": round(max_ctr, 4),
            "risk_score": min(risk_score, 1.0)
        }

    def _combine_risk_scores(
        self,
        crawl: dict[str, Any],
        gam: dict[str, Any],
        social: dict[str, Any] = None,
    ) -> float:
        """Combine risk scores from different sources with weighting."""
        crawl_score = crawl.get("risk_score", 0)
        gam_score = gam.get("risk_score", 0)
        social_score = social.get("score", 0) if social else 0
        
        # Weighting: GAM data is more reliable if available
        if gam_score > 0:
            return (gam_score * 0.6) + (crawl_score * 0.3) + (social_score * 0.1)
        else:
            return (crawl_score * 0.7) + (social_score * 0.3)

    def _get_risk_level(self, score: float) -> str:
        if score <= 0.3: return "low"
        if score <= 0.6: return "medium"
        return "high"
