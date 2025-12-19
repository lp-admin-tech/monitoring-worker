"""
Risk Engine - Calculates MFA probability using confidence-weighted scoring.
Supports GAM-only mode when crawler is blocked.
"""

import math
from typing import Any

from src.utils.logger import get_logger

logger = get_logger(__name__)


class RiskEngine:
    """
    Calculates MFA risk using multiple scoring algorithms:
    - Confidence-weighted component scoring
    - GAM-only mode for blocked crawls
    """
    
    def calculate_score(
        self,
        content_analysis: dict[str, Any],
        ad_analysis: dict[str, Any],
        technical_check: dict[str, Any],
        policy_check: dict[str, Any],
        gam_data: list[dict[str, Any]] | None = None,
        crawl_status: str = "SUCCESS",
    ) -> dict[str, Any]:
        """
        Calculate MFA risk score with support for blocked crawl fallback.
        
        Args:
            content_analysis: Content analyzer results
            ad_analysis: Ad analyzer results
            technical_check: Technical checker results
            policy_check: Policy checker results
            gam_data: Historical GAM data (optional)
            crawl_status: SUCCESS, BLOCKED, FALLBACK, or FAILED
        """
        # Check if we need GAM-only mode
        is_blocked = crawl_status == "BLOCKED"
        has_gam_data = gam_data and len(gam_data) > 0
        
        if is_blocked and has_gam_data:
            logger.info("Using GAM-only scoring mode (crawl was blocked)")
            return self._calculate_gam_only_score(gam_data, crawl_status)
        elif is_blocked and not has_gam_data:
            logger.warning("Crawl blocked and no GAM data available - returning inconclusive")
            return self._inconclusive_result(crawl_status)
        
        # Standard multi-component scoring
        return self._calculate_full_score(
            content_analysis, ad_analysis, technical_check, policy_check, gam_data, crawl_status
        )
    
    def _calculate_full_score(
        self,
        content_analysis: dict[str, Any],
        ad_analysis: dict[str, Any],
        technical_check: dict[str, Any],
        policy_check: dict[str, Any],
        gam_data: list[dict[str, Any]] | None,
        crawl_status: str,
    ) -> dict[str, Any]:
        """Full multi-component scoring when crawl succeeds."""
        components = {}
        
        # 1. Content Risk (Weight: 0.25)
        content_score = content_analysis.get("risk_score", 0.5)
        content_conf = min(content_analysis.get("word_count", 0) / 500, 1.0) if "error" not in content_analysis else 0.2
        components["content"] = {"score": content_score, "weight": 0.25, "confidence": content_conf}
        
        # 2. Ad Risk (Weight: 0.35)
        ad_score = ad_analysis.get("risk_score", 0.5)
        ad_conf = 1.0 if ad_analysis.get("ad_count", 0) > 0 else 0.7
        components["ad"] = {"score": ad_score, "weight": 0.35, "confidence": ad_conf}
        
        # 3. GAM/Traffic Risk (Weight: 0.25)
        gam_score = self._calculate_gam_risk(gam_data) if gam_data else 0.5
        gam_conf = 1.0 if gam_data and len(gam_data) > 0 else 0.3
        components["traffic"] = {"score": gam_score, "weight": 0.25, "confidence": gam_conf}
        
        # 4. Technical/Policy Risk (Weight: 0.15)
        tech_score = technical_check.get("health_score", 50) / 100
        tech_conf = 0.8
        components["technical"] = {"score": 1 - tech_score, "weight": 0.15, "confidence": tech_conf}
        
        # Calculate weighted average
        total_weight = sum(c["weight"] * c["confidence"] for c in components.values())
        weighted_score = sum(c["score"] * c["weight"] * c["confidence"] for c in components.values())
        
        mfa_probability = weighted_score / total_weight if total_weight > 0 else 0.5
        overall_confidence = sum(c["confidence"] * c["weight"] for c in components.values())
        
        # Adjust confidence if crawl was fallback
        if crawl_status == "FALLBACK":
            overall_confidence *= 0.8
        
        return {
            "risk_score": round(mfa_probability * 100, 2),
            "mfa_probability": round(mfa_probability, 4),
            "confidence": round(overall_confidence, 4),
            "risk_level": self._get_risk_level(mfa_probability),
            "components": components,
            "scoring_mode": "full",
            "crawl_status": crawl_status,
        }
    
    def _calculate_gam_only_score(
        self,
        gam_data: list[dict[str, Any]],
        crawl_status: str,
    ) -> dict[str, Any]:
        """GAM-only scoring when crawler is blocked."""
        gam_score = self._calculate_gam_risk(gam_data)
        
        # GAM-only has lower confidence but can still detect MFA signals
        confidence = 0.6  # Lower than full scoring
        
        return {
            "risk_score": round(gam_score * 100, 2),
            "mfa_probability": round(gam_score, 4),
            "confidence": confidence,
            "risk_level": self._get_risk_level(gam_score),
            "components": {
                "gam": {"score": gam_score, "weight": 1.0, "confidence": confidence}
            },
            "scoring_mode": "gam_only",
            "crawl_status": crawl_status,
            "note": "Site blocked crawler. Score based on advertising data only.",
        }
    
    def _calculate_gam_risk(self, gam_data: list[dict[str, Any]]) -> float:
        """Calculate MFA risk from GAM data."""
        if not gam_data:
            return 0.5
        
        total_impressions = sum(int(r.get("impressions", 0)) for r in gam_data)
        total_clicks = sum(int(r.get("clicks", 0)) for r in gam_data)
        total_revenue = sum(float(r.get("revenue", 0)) for r in gam_data)
        
        if total_impressions == 0:
            return 0.5
        
        avg_ctr = (total_clicks / total_impressions * 100) if total_impressions > 0 else 0
        avg_ecpm = (total_revenue / total_impressions * 1000) if total_impressions > 0 else 0
        
        risk = 0.0
        
        # MFA Classic: High CTR + Low eCPM
        if avg_ctr > 2.0 and avg_ecpm < 0.5:
            risk += 0.4
        elif avg_ctr > 1.0 and avg_ecpm < 1.0:
            risk += 0.25
        
        # Clickbait: Very high CTR
        if avg_ctr > 5.0:
            risk += 0.3
        elif avg_ctr > 3.0:
            risk += 0.15
        
        # Low quality: Very low eCPM
        if avg_ecpm < 0.1:
            risk += 0.2
        elif avg_ecpm < 0.25:
            risk += 0.1
        
        return min(risk, 1.0)
    
    def _inconclusive_result(self, crawl_status: str) -> dict[str, Any]:
        """Return inconclusive result when no data is available."""
        return {
            "risk_score": 0,
            "mfa_probability": 0,
            "confidence": 0,
            "risk_level": "inconclusive",
            "components": {},
            "scoring_mode": "none",
            "crawl_status": crawl_status,
            "note": "Insufficient data to calculate risk. Site blocked crawler and no GAM data available.",
        }
    
    def _get_risk_level(self, score: float) -> str:
        if score <= 0.3: return "low"
        if score <= 0.6: return "medium"
        return "high"
