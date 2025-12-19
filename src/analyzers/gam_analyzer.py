"""
GAM Metrics Analyzer - Analyzes Google Ad Manager data for MFA correlation.
Ported from JS worker's gam-metrics-analyzer.js
"""

from typing import Any
from datetime import datetime, timedelta, timezone

from src.utils.logger import get_logger

logger = get_logger(__name__)


# Industry-standard thresholds for suspicious GAM metrics (2024 research)
# Source: IAS, Pixalate, MRC, IAB benchmarks

CTR_THRESHOLDS = {
    # Industry avg display CTR is 0.46%, search is 3.17%
    # For display/programmatic, CTR >1% is suspicious
    "suspicious_high": 0.03,   # 3%+ CTR = likely click fraud
    "elevated": 0.015,         # 1.5%+ is elevated for display
    "normal_max": 0.01,        # 1% is upper bound for healthy display
    "programmatic_avg": 0.0046,  # Industry avg: 0.46%
}

ECPM_THRESHOLDS = {
    # Display eCPM avg: $2.50-$4.50, low-quality MFA sites typically <$1
    "very_low": 0.50,          # <$0.50 = very low quality traffic (MFA)
    "low": 1.00,               # <$1.00 = low value (suspicious)
    "below_avg": 2.00,         # <$2.00 = below industry average
    "industry_avg": 3.50,      # Industry average for display
}

VIEWABILITY_THRESHOLDS = {
    # MRC Standard: 50% pixels viewable for 1 second (display)
    # Industry avg is ~76%, good sites >70%
    "poor": 40,                # <40% = poor (MFA often achieve high here!)
    "mrc_minimum": 50,         # 50% = MRC minimum standard
    "good": 70,                # 70%+ is good
    "industry_avg": 76,        # Industry average
}

# MFA detection: High CTR + Low eCPM = key indicator
MFA_CORRELATION = {
    "high_ctr_low_ecpm": True,  # CTR >1% AND eCPM <$1 = strong MFA signal
}


class GAMMetricsAnalyzer:
    """
    Analyzes GAM (Google Ad Manager) data for MFA indicators.
    
    MFA sites often show:
    - Unusually high CTR (click fraud)
    - Very low eCPM (low value traffic)
    - Poor viewability
    - High impression/low revenue ratio
    """
    
    def analyze(
        self,
        gam_data: list[dict[str, Any]],
        days_back: int = 30,
    ) -> dict[str, Any]:
        """
        Analyze GAM metrics for MFA patterns.
        
        Args:
            gam_data: Historical GAM report data
            days_back: Number of days to analyze
            
        Returns:
            Analysis with risk indicators
        """
        if not gam_data:
            return self._empty_result()
        
        # Filter to recent data
        cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
        recent_data = [
            d for d in gam_data
            if self._parse_date(d.get("report_date")) >= cutoff
        ]
        
        if not recent_data:
            return self._empty_result()
        
        # Calculate aggregated metrics
        metrics = self._calculate_aggregate_metrics(recent_data)
        
        # Analyze for suspicious patterns
        suspicious_patterns = self._detect_suspicious_patterns(metrics)
        
        # Calculate risk score
        risk_score = self._calculate_risk_score(metrics, suspicious_patterns)
        
        return {
            "has_data": True,
            "data_points": len(recent_data),
            "date_range": {
                "start": min(d.get("report_date", "") for d in recent_data),
                "end": max(d.get("report_date", "") for d in recent_data),
            },
            "metrics": metrics,
            "suspicious_patterns": suspicious_patterns,
            "risk_score": round(risk_score, 4),
            "risk_level": self._get_risk_level(risk_score),
        }
    
    def _calculate_aggregate_metrics(
        self,
        data: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Calculate aggregate metrics from GAM data."""
        total_impressions = sum(d.get("impressions", 0) for d in data)
        total_clicks = sum(d.get("clicks", 0) for d in data)
        total_revenue = sum(d.get("revenue", 0) for d in data)
        
        # Calculate averages
        avg_ctr = total_clicks / max(total_impressions, 1)
        avg_ecpm = (total_revenue / max(total_impressions, 1)) * 1000
        
        # Viewability (if available)
        viewability_values = [d.get("viewability", 0) for d in data if d.get("viewability")]
        avg_viewability = (
            sum(viewability_values) / len(viewability_values)
            if viewability_values else None
        )
        
        # Fill rate
        fill_rates = [d.get("fill_rate", 0) for d in data if d.get("fill_rate")]
        avg_fill_rate = (
            sum(fill_rates) / len(fill_rates)
            if fill_rates else None
        )
        
        return {
            "total_impressions": total_impressions,
            "total_clicks": total_clicks,
            "total_revenue": round(total_revenue, 2),
            "average_ctr": round(avg_ctr, 6),
            "average_ecpm": round(avg_ecpm, 4),
            "average_viewability": round(avg_viewability, 2) if avg_viewability else None,
            "average_fill_rate": round(avg_fill_rate, 2) if avg_fill_rate else None,
        }
    
    def _detect_suspicious_patterns(
        self,
        metrics: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Detect suspicious patterns in GAM metrics."""
        patterns = []
        
        # High CTR check
        ctr = metrics.get("average_ctr", 0)
        if ctr >= CTR_THRESHOLDS["suspicious_high"]:
            patterns.append({
                "type": "suspicious_high_ctr",
                "description": f"CTR is {ctr*100:.2f}% (threshold: {CTR_THRESHOLDS['suspicious_high']*100}%)",
                "severity": "high",
                "value": ctr,
            })
        elif ctr >= CTR_THRESHOLDS["elevated"]:
            patterns.append({
                "type": "elevated_ctr",
                "description": f"CTR is elevated at {ctr*100:.2f}%",
                "severity": "medium",
                "value": ctr,
            })
        
        # Low eCPM check
        ecpm = metrics.get("average_ecpm", 0)
        if ecpm <= ECPM_THRESHOLDS["very_low"]:
            patterns.append({
                "type": "very_low_ecpm",
                "description": f"eCPM is ${ecpm:.2f} (very low value traffic)",
                "severity": "high",
                "value": ecpm,
            })
        elif ecpm <= ECPM_THRESHOLDS["low"]:
            patterns.append({
                "type": "low_ecpm",
                "description": f"eCPM is ${ecpm:.2f} (low value traffic)",
                "severity": "medium",
                "value": ecpm,
            })
        
        # Poor viewability check
        viewability = metrics.get("average_viewability")
        if viewability is not None:
            if viewability < VIEWABILITY_THRESHOLDS["poor"]:
                patterns.append({
                    "type": "poor_viewability",
                    "description": f"Viewability is {viewability:.1f}% (poor)",
                    "severity": "high",
                    "value": viewability,
                })
            elif viewability < VIEWABILITY_THRESHOLDS["acceptable"]:
                patterns.append({
                    "type": "low_viewability",
                    "description": f"Viewability is {viewability:.1f}% (below acceptable)",
                    "severity": "medium",
                    "value": viewability,
                })
        
        # High impressions / low revenue ratio
        impressions = metrics.get("total_impressions", 0)
        revenue = metrics.get("total_revenue", 0)
        if impressions > 100000 and revenue > 0:
            revenue_per_1k = (revenue / impressions) * 1000
            if revenue_per_1k < 0.50:
                patterns.append({
                    "type": "low_monetization",
                    "description": f"Only ${revenue_per_1k:.2f} per 1000 impressions",
                    "severity": "medium",
                    "value": revenue_per_1k,
                })
        
        return patterns
    
    def _calculate_risk_score(
        self,
        metrics: dict[str, Any],
        suspicious_patterns: list[dict[str, Any]],
    ) -> float:
        """Calculate GAM correlation risk score (0-1)."""
        score = 0.0
        
        # CTR contribution
        ctr = metrics.get("average_ctr", 0)
        if ctr >= 0.05:
            score += 0.3
        elif ctr >= 0.03:
            score += 0.15
        
        # eCPM contribution
        ecpm = metrics.get("average_ecpm", 10)  # Default high to not penalize missing data
        if ecpm <= 0.5:
            score += 0.25
        elif ecpm <= 1.0:
            score += 0.12
        
        # Viewability contribution
        viewability = metrics.get("average_viewability")
        if viewability is not None:
            if viewability < 40:
                score += 0.2
            elif viewability < 50:
                score += 0.1
        
        # Pattern count contribution
        high_severity = sum(1 for p in suspicious_patterns if p["severity"] == "high")
        score += min(high_severity * 0.1, 0.25)
        
        return min(score, 1.0)
    
    def _get_risk_level(self, risk_score: float) -> str:
        """Map risk score to level."""
        if risk_score >= 0.6:
            return "high"
        elif risk_score >= 0.3:
            return "medium"
        else:
            return "low"
    
    def _parse_date(self, date_str: str | None) -> datetime:
        """Parse date string or return a very old date."""
        if not date_str:
            return datetime.min.replace(tzinfo=timezone.utc)
        
        try:
            if "T" in date_str:
                return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            return datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except Exception:
            return datetime.min.replace(tzinfo=timezone.utc)
    
    def _empty_result(self) -> dict[str, Any]:
        """Return empty result when no GAM data available."""
        return {
            "has_data": False,
            "data_points": 0,
            "metrics": {},
            "suspicious_patterns": [],
            "risk_score": 0.3,  # Default moderate uncertainty
            "risk_level": "unknown",
        }


# Convenience instance
gam_analyzer = GAMMetricsAnalyzer()
