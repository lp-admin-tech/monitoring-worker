"""
Invalid Traffic (IVT) Detector - Detects patterns that could cause Google account closure.
Based on Google AdSense/Ad Manager invalid traffic policies.
"""

import re
from typing import Any
from datetime import datetime, timedelta, timezone

from src.utils.logger import get_logger
from src.crawlers.audit_crawler import CrawlResult

logger = get_logger(__name__)


class IVTDetector:
    """
    Detects Invalid Traffic patterns that could cause Google account closure.
    
    Based on:
    - Google AdSense Traffic Quality Guidelines
    - Google Ad Manager Invalid Traffic Policies
    """
    
    def async_analyze(self, crawl_result: CrawlResult, gam_data: list[dict[str, Any]] = None) -> dict[str, Any]:
        """Analyze for invalid traffic risks."""
        logger.info("Analyzing IVT risks", url=crawl_result.url)
        
        # 1. Analyze crawl data for placement violations
        placement_violations = self._detect_placement_violations(crawl_result)
        
        # 2. Analyze GAM data for suspicious CTR/impression spikes
        gam_violations = self._analyze_gam_data(gam_data) if gam_data else []
        
        # Combine all violations
        all_violations = placement_violations + gam_violations
        
        # Calculate overall IVT risk score
        risk_score = self._calculate_risk_score(all_violations)
        
        return {
            "violations": all_violations,
            "violation_count": len(all_violations),
            "risk_score": round(risk_score, 2),
            "risk_level": self._get_risk_level(risk_score),
            "is_ivt_likely": risk_score > 0.5,
            "recommendations": self._generate_recommendations(all_violations),
        }

    def _detect_placement_violations(self, crawl_result: CrawlResult) -> list[dict[str, Any]]:
        """Detect ad placement violations from crawl data."""
        violations = []
        ad_elements = crawl_result.ad_elements or []
        navigation = crawl_result.navigation or {}
        
        # 1. Ads near navigation (accidental click risk)
        nav_elements = navigation.get("elements", [])
        for ad in ad_elements:
            ad_x, ad_y = ad.get("x", 0), ad.get("y", 0)
            for nav in nav_elements:
                nav_x, nav_y = nav.get("x", 0), nav.get("y", 0)
                # If ad is within 50px of navigation
                if abs(ad_x - nav_x) < 50 and abs(ad_y - nav_y) < 50:
                    violations.append({
                        "type": "ad_near_navigation",
                        "severity": "high",
                        "description": "Ad placed too close to navigation elements",
                        "selector": ad.get("selector", "unknown"),
                    })
                    break
        
        # 2. Deceptive ad labels (e.g. "Download", "Play")
        deceptive_labels = ["download", "play", "start", "click here", "next", "continue"]
        for ad in ad_elements:
            # Check surrounding text or class names for deceptive labels
            context = f"{ad.get('id', '')} {ad.get('class', '')}".lower()
            for label in deceptive_labels:
                if label in context:
                    violations.append({
                        "type": "deceptive_ad_label",
                        "severity": "critical",
                        "description": f"Ad associated with deceptive label: '{label}'",
                        "selector": ad.get("selector", "unknown"),
                    })
                    break
        
        # 3. Excessive ads above the fold
        atf_ads = [ad for ad in ad_elements if ad.get("y", 0) < 1000]
        if len(atf_ads) > 3:
            violations.append({
                "type": "excessive_atf_ads",
                "severity": "medium",
                "description": f"Found {len(atf_ads)} ads above the fold",
            })
            
        return violations

    def _analyze_gam_data(self, gam_data: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Analyze GAM data for IVT signals."""
        violations = []
        if not gam_data:
            return []
            
        # Calculate CTRs
        ctrs = []
        for r in gam_data:
            imps = float(r.get("impressions", 0))
            clicks = float(r.get("clicks", 0))
            if imps > 100:  # Only consider statistically significant days
                ctrs.append(clicks / imps)
                
        if not ctrs:
            return []
            
        avg_ctr = sum(ctrs) / len(ctrs)
        
        # 1. High CTR (Global threshold)
        if avg_ctr > 0.1:  # >10% CTR is extremely high for display
            violations.append({
                "type": "extreme_ctr",
                "severity": "critical",
                "description": f"Extremely high average CTR: {avg_ctr*100:.1f}%",
            })
        elif avg_ctr > 0.05:
            violations.append({
                "type": "high_ctr",
                "severity": "high",
                "description": f"High average CTR: {avg_ctr*100:.1f}%",
            })
            
        # 2. CTR Spikes (Local anomaly)
        for i, ctr in enumerate(ctrs):
            if ctr > avg_ctr * 4 and ctr > 0.05:
                violations.append({
                    "type": "ctr_spike",
                    "severity": "high",
                    "description": f"Suspicious CTR spike detected: {ctr*100:.1f}% on day {i+1}",
                })
                
        return violations

    def _calculate_risk_score(self, violations: list[dict[str, Any]]) -> float:
        """Calculate overall IVT risk score (0-1)."""
        if not violations:
            return 0.0
            
        score = 0.0
        for v in violations:
            severity = v.get("severity", "low")
            if severity == "critical": score += 0.4
            elif severity == "high": score += 0.2
            elif severity == "medium": score += 0.1
            
        return min(score, 1.0)

    def _get_risk_level(self, score: float) -> str:
        if score <= 0.3: return "low"
        if score <= 0.6: return "medium"
        return "high"

    def _generate_recommendations(self, violations: list[dict[str, Any]]) -> list[str]:
        """Generate actionable recommendations."""
        recs = []
        types = set(v["type"] for v in violations)
        
        if "ad_near_navigation" in types:
            recs.append("Move ads at least 50px away from navigation elements to prevent accidental clicks.")
        if "deceptive_ad_label" in types:
            recs.append("Remove all deceptive labels (Download, Play, etc.) near ad units immediately.")
        if "extreme_ctr" in types or "high_ctr" in types:
            recs.append("Investigate traffic sources for potential click fraud or bot activity.")
        if "ctr_spike" in types:
            recs.append("Review traffic quality for the days where CTR spikes were detected.")
            
        if not recs:
            recs.append("No immediate IVT risks detected. Continue monitoring traffic quality.")
            
        return recs
