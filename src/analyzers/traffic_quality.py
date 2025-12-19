"""
Traffic Quality Analyzer - Analyzes GAM data for MFA/arbitrage patterns.

Uses reports_dimensional data to detect:
- Geographic traffic quality (Tier 1 vs low-value countries)
- Traffic source patterns (organic vs social arbitrage)
- CTR anomalies by country/device
- Viewability issues
- Invalid traffic signals
"""

from typing import Any
from src.utils.logger import get_logger

logger = get_logger(__name__)


# Country value tiers for ad revenue
TIER1_COUNTRIES = {
    "United States", "Canada", "United Kingdom", "Germany", "France",
    "Australia", "Netherlands", "Switzerland", "Norway", "Sweden",
    "Denmark", "Austria", "Belgium", "Ireland", "New Zealand",
}

TIER2_COUNTRIES = {
    "Italy", "Spain", "Japan", "South Korea", "Singapore", "Israel",
    "Finland", "Portugal", "Greece", "Czech Republic", "Poland",
}

# Social/referral traffic sources (arbitrage indicators)
SOCIAL_TRAFFIC_SOURCES = {
    "Facebook", "Instagram", "Messenger", "TikTok", "Pinterest",
    "Snapchat", "Twitter", "Reddit", "WhatsApp",
}

# Low-quality in-app browsers often used for arbitrage
INAPP_BROWSERS = {"In-app browser", "WebView"}


class TrafficQualityAnalyzer:
    """
    Analyzes GAM dimensional data for traffic quality signals.
    
    Produces metrics for:
    - Geographic quality score
    - Traffic source breakdown
    - CTR anomaly detection
    - Viewability analysis
    - Overall traffic quality score
    """
    
    def __init__(self, gam_data: list[dict[str, Any]] | None = None):
        self.gam_data = gam_data or []
    
    def analyze(self) -> dict[str, Any]:
        """Run comprehensive traffic quality analysis."""
        if not self.gam_data:
            return {"has_data": False, "traffic_quality_score": 50}
        
        # Aggregate metrics
        geo_analysis = self._analyze_geographic()
        source_analysis = self._analyze_traffic_sources()
        ctr_analysis = self._analyze_ctr_anomalies()
        viewability_analysis = self._analyze_viewability()
        ecpm_analysis = self._analyze_ecpm()
        
        # Calculate overall score
        traffic_quality_score = self._calculate_quality_score(
            geo_analysis, source_analysis, ctr_analysis, viewability_analysis, ecpm_analysis
        )
        
        # Determine flags
        flags = self._compute_flags(
            geo_analysis, source_analysis, ctr_analysis, viewability_analysis, ecpm_analysis
        )
        
        result = {
            "has_data": True,
            "records_analyzed": len(self.gam_data),
            "geographic": geo_analysis,
            "traffic_sources": source_analysis,
            "ctr_analysis": ctr_analysis,
            "viewability": viewability_analysis,
            "ecpm_analysis": ecpm_analysis,
            "traffic_quality_score": round(traffic_quality_score, 2),
            "risk_level": self._get_risk_level(traffic_quality_score),
            **flags,
        }
        
        logger.info(
            "Traffic quality analysis complete",
            score=result["traffic_quality_score"],
            tier1_pct=geo_analysis.get("tier1_percentage", 0),
            social_pct=source_analysis.get("social_traffic_percentage", 0),
            avg_ecpm=ecpm_analysis.get("average_ecpm", 0),
        )
        
        return result
    
    def _analyze_geographic(self) -> dict[str, Any]:
        """Analyze geographic distribution of traffic."""
        total_impressions = 0
        tier1_impressions = 0
        tier2_impressions = 0
        country_impressions: dict[str, int] = {}
        country_revenue: dict[str, float] = {}
        
        for record in self.gam_data:
            country = record.get("country_name", "N/A")
            impressions = int(record.get("impressions", 0))
            revenue = float(record.get("revenue", 0))
            
            total_impressions += impressions
            country_impressions[country] = country_impressions.get(country, 0) + impressions
            country_revenue[country] = country_revenue.get(country, 0) + revenue
            
            if country in TIER1_COUNTRIES:
                tier1_impressions += impressions
            elif country in TIER2_COUNTRIES:
                tier2_impressions += impressions
        
        # Top countries by impressions
        sorted_countries = sorted(
            country_impressions.items(), key=lambda x: x[1], reverse=True
        )[:10]
        
        return {
            "total_impressions": total_impressions,
            "tier1_impressions": tier1_impressions,
            "tier1_percentage": round(tier1_impressions / total_impressions * 100, 2) if total_impressions else 0,
            "tier2_percentage": round(tier2_impressions / total_impressions * 100, 2) if total_impressions else 0,
            "top_countries": [{"country": c, "impressions": i} for c, i in sorted_countries[:5]],
            "country_count": len(country_impressions),
        }
    
    def _analyze_traffic_sources(self) -> dict[str, Any]:
        """Analyze traffic source patterns from mobile_app_name and browser."""
        total_impressions = 0
        social_impressions = 0
        inapp_impressions = 0
        google_impressions = 0
        source_breakdown: dict[str, int] = {}
        
        for record in self.gam_data:
            impressions = int(record.get("impressions", 0))
            mobile_app = record.get("mobile_app_name", "Unknown")
            browser = record.get("browser_name", "")
            
            total_impressions += impressions
            source_breakdown[mobile_app] = source_breakdown.get(mobile_app, 0) + impressions
            
            # Detect social traffic
            if mobile_app in SOCIAL_TRAFFIC_SOURCES:
                social_impressions += impressions
            
            # Detect Google organic
            if mobile_app in {"Google", "Google Go"}:
                google_impressions += impressions
            
            # Detect in-app browser traffic
            if browser in INAPP_BROWSERS:
                inapp_impressions += impressions
        
        return {
            "total_impressions": total_impressions,
            "social_traffic_impressions": social_impressions,
            "social_traffic_percentage": round(social_impressions / total_impressions * 100, 2) if total_impressions else 0,
            "google_traffic_percentage": round(google_impressions / total_impressions * 100, 2) if total_impressions else 0,
            "inapp_browser_percentage": round(inapp_impressions / total_impressions * 100, 2) if total_impressions else 0,
            "top_sources": sorted(source_breakdown.items(), key=lambda x: x[1], reverse=True)[:5],
        }
    
    def _analyze_ctr_anomalies(self) -> dict[str, Any]:
        """Detect CTR anomalies that indicate invalid traffic."""
        total_impressions = 0
        total_clicks = 0
        high_ctr_impressions = 0  # CTR > 5%
        extreme_ctr_impressions = 0  # CTR > 10%
        ctr_by_country: dict[str, dict] = {}
        
        for record in self.gam_data:
            impressions = int(record.get("impressions", 0))
            clicks = int(record.get("clicks", 0))
            ctr = float(record.get("ctr", 0))
            country = record.get("country_name", "N/A")
            
            total_impressions += impressions
            total_clicks += clicks
            
            if ctr > 5:
                high_ctr_impressions += impressions
            if ctr > 10:
                extreme_ctr_impressions += impressions
            
            # Track CTR by country
            if country not in ctr_by_country:
                ctr_by_country[country] = {"impressions": 0, "clicks": 0}
            ctr_by_country[country]["impressions"] += impressions
            ctr_by_country[country]["clicks"] += clicks
        
        # Find countries with anomalous CTR
        anomaly_countries = []
        for country, data in ctr_by_country.items():
            if data["impressions"] > 50:  # Minimum threshold
                country_ctr = data["clicks"] / data["impressions"] * 100
                if country_ctr > 5:
                    anomaly_countries.append({
                        "country": country,
                        "ctr": round(country_ctr, 2),
                        "impressions": data["impressions"],
                    })
        
        avg_ctr = (total_clicks / total_impressions * 100) if total_impressions else 0
        
        return {
            "average_ctr": round(avg_ctr, 2),
            "high_ctr_percentage": round(high_ctr_impressions / total_impressions * 100, 2) if total_impressions else 0,
            "extreme_ctr_percentage": round(extreme_ctr_impressions / total_impressions * 100, 2) if total_impressions else 0,
            "anomaly_countries": sorted(anomaly_countries, key=lambda x: x["ctr"], reverse=True)[:5],
            "has_ctr_anomalies": len(anomaly_countries) > 0,
        }
    
    def _analyze_viewability(self) -> dict[str, Any]:
        """Analyze viewability metrics."""
        total_impressions = 0
        weighted_viewability = 0
        low_viewability_impressions = 0  # < 40%
        
        for record in self.gam_data:
            impressions = int(record.get("impressions", 0))
            viewability = float(record.get("viewability", 0))
            
            if impressions > 0:
                total_impressions += impressions
                weighted_viewability += viewability * impressions
                
                if viewability < 0.4:
                    low_viewability_impressions += impressions
        
        avg_viewability = (weighted_viewability / total_impressions) if total_impressions else 0
        
        return {
            "average_viewability": round(avg_viewability * 100, 2),
            "low_viewability_percentage": round(low_viewability_impressions / total_impressions * 100, 2) if total_impressions else 0,
            "viewability_ok": avg_viewability >= 0.5,
        }
    
    def _analyze_ecpm(self) -> dict[str, Any]:
        """Analyze eCPM for arbitrage detection."""
        total_revenue = 0.0
        total_impressions = 0
        low_ecpm_impressions = 0  # eCPM < $0.10
        very_low_ecpm_impressions = 0  # eCPM < $0.05
        
        for record in self.gam_data:
            impressions = int(record.get("impressions", 0))
            revenue = float(record.get("revenue", 0))
            ecpm = float(record.get("ecpm", 0))
            
            if impressions > 0:
                total_impressions += impressions
                total_revenue += revenue
                
                if ecpm < 0.10:
                    low_ecpm_impressions += impressions
                if ecpm < 0.05:
                    very_low_ecpm_impressions += impressions
        
        avg_ecpm = (total_revenue / total_impressions * 1000) if total_impressions else 0
        
        return {
            "average_ecpm": round(avg_ecpm, 4),
            "total_revenue": round(total_revenue, 2),
            "low_ecpm_percentage": round(low_ecpm_impressions / total_impressions * 100, 2) if total_impressions else 0,
            "very_low_ecpm_percentage": round(very_low_ecpm_impressions / total_impressions * 100, 2) if total_impressions else 0,
            "is_arbitrage_risk": avg_ecpm < 0.10,
        }
    
    def _calculate_quality_score(
        self,
        geo: dict,
        source: dict,
        ctr: dict,
        viewability: dict,
        ecpm: dict = None,
    ) -> float:
        """Calculate overall traffic quality score (0-100)."""
        score = 50.0  # Start at neutral
        ecpm = ecpm or {}
        
        # Geographic quality (+/- 20 points)
        tier1_pct = geo.get("tier1_percentage", 0)
        if tier1_pct >= 50:
            score += 20
        elif tier1_pct >= 25:
            score += 10
        elif tier1_pct < 10:
            score -= 15
        
        # Traffic source quality (+/- 15 points)
        social_pct = source.get("social_traffic_percentage", 0)
        if social_pct > 50:
            score -= 15  # Heavy social arbitrage
        elif social_pct > 25:
            score -= 8
        elif social_pct < 10:
            score += 10  # Organic traffic
        
        # CTR anomalies (+/- 15 points)
        if ctr.get("extreme_ctr_percentage", 0) > 5:
            score -= 15  # Severe invalid traffic
        elif ctr.get("high_ctr_percentage", 0) > 10:
            score -= 10
        elif ctr.get("average_ctr", 0) < 2:
            score += 10  # Normal CTR
        
        # Viewability (+/- 10 points)
        avg_view = viewability.get("average_viewability", 50)
        if avg_view >= 60:
            score += 10
        elif avg_view < 40:
            score -= 10
        
        # eCPM quality (+/- 15 points)
        avg_ecpm = ecpm.get("average_ecpm", 0.5)
        if avg_ecpm >= 1.0:
            score += 15  # Good eCPM
        elif avg_ecpm >= 0.5:
            score += 5
        elif avg_ecpm < 0.10:
            score -= 15  # Arbitrage indicator
        elif avg_ecpm < 0.25:
            score -= 8
        
        return max(0, min(100, score))
    
    def _compute_flags(
        self,
        geo: dict,
        source: dict,
        ctr: dict,
        viewability: dict,
        ecpm: dict = None,
    ) -> dict[str, bool]:
        """Compute boolean MFA flags."""
        ecpm = ecpm or {}
        return {
            "arbitrage_traffic_signal": source.get("social_traffic_percentage", 0) > 40,
            "low_tier_traffic_signal": geo.get("tier1_percentage", 0) < 15,
            "invalid_traffic_signal": ctr.get("extreme_ctr_percentage", 0) > 5,
            "low_viewability_signal": viewability.get("average_viewability", 50) < 40,
            "geographic_concentration": geo.get("country_count", 0) < 5,
            "low_ecpm_signal": ecpm.get("average_ecpm", 0.5) < 0.10,
        }
    
    def _get_risk_level(self, score: float) -> str:
        """Map score to risk level."""
        if score >= 70:
            return "low"
        elif score >= 40:
            return "medium"
        else:
            return "high"
