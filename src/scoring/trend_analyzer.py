"""
Trend Analyzer - Analyzes historical audit data for trends.
Ported from JS worker's trend-analyzer.js
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from src.utils.logger import get_logger

logger = get_logger(__name__)


class TrendAnalyzer:
    """
    Analyzes historical audit data to detect trends.
    
    Features:
    - Score trend detection (improving/declining)
    - Anomaly detection
    - Change rate calculation
    """
    
    def analyze_trends(
        self,
        current_audit: dict[str, Any],
        historical_audits: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """
        Analyze trends comparing current audit to historical data.
        
        Args:
            current_audit: Current audit results
            historical_audits: Previous audit results (sorted by date desc)
            
        Returns:
            Trend analysis with direction and insights
        """
        if not historical_audits:
            return {
                "has_history": False,
                "trend_direction": "unknown",
                "change_rate": 0,
                "insights": [],
            }
        
        current_score = current_audit.get("risk_score", 0)
        
        # Get historical scores
        historical_scores = [
            a.get("risk_score", 0) for a in historical_audits
            if a.get("risk_score") is not None
        ]
        
        if not historical_scores:
            return {
                "has_history": False,
                "trend_direction": "unknown",
                "change_rate": 0,
                "insights": [],
            }
        
        # Calculate trend metrics
        avg_historical = sum(historical_scores) / len(historical_scores)
        latest_historical = historical_scores[0] if historical_scores else avg_historical
        
        # Calculate change rate
        if latest_historical > 0:
            change_rate = (current_score - latest_historical) / latest_historical
        else:
            change_rate = 0
        
        # Determine trend direction
        if change_rate > 0.1:
            trend_direction = "worsening"
        elif change_rate < -0.1:
            trend_direction = "improving"
        else:
            trend_direction = "stable"
        
        # Generate insights
        insights = self._generate_insights(
            current_score=current_score,
            avg_historical=avg_historical,
            latest_historical=latest_historical,
            change_rate=change_rate,
            historical_count=len(historical_audits),
        )
        
        # Detect anomalies
        is_anomaly = self._detect_anomaly(
            current_score=current_score,
            historical_scores=historical_scores,
        )
        
        return {
            "has_history": True,
            "trend_direction": trend_direction,
            "change_rate": round(change_rate * 100, 2),  # As percentage
            "current_score": round(current_score, 4),
            "average_historical_score": round(avg_historical, 4),
            "latest_historical_score": round(latest_historical, 4),
            "historical_count": len(historical_audits),
            "is_anomaly": is_anomaly,
            "insights": insights,
        }
    
    def _generate_insights(
        self,
        current_score: float,
        avg_historical: float,
        latest_historical: float,
        change_rate: float,
        historical_count: int,
    ) -> list[str]:
        """Generate human-readable trend insights."""
        insights = []
        
        # Score comparison insights
        if current_score > avg_historical * 1.2:
            insights.append(
                f"Risk score is {((current_score / avg_historical) - 1) * 100:.0f}% higher than historical average"
            )
        elif current_score < avg_historical * 0.8:
            insights.append(
                f"Risk score has improved {((1 - current_score / avg_historical)) * 100:.0f}% from historical average"
            )
        
        # Recent change insights
        if abs(change_rate) > 0.2:
            direction = "increased" if change_rate > 0 else "decreased"
            insights.append(
                f"Risk score has {direction} significantly since last audit"
            )
        
        # Data sufficiency
        if historical_count < 3:
            insights.append("Limited historical data - trends may not be reliable")
        elif historical_count >= 10:
            insights.append(f"Analysis based on {historical_count} historical audits")
        
        return insights
    
    def _detect_anomaly(
        self,
        current_score: float,
        historical_scores: list[float],
    ) -> bool:
        """Detect if current score is an anomaly."""
        if len(historical_scores) < 3:
            return False
        
        # Calculate mean and standard deviation
        mean = sum(historical_scores) / len(historical_scores)
        variance = sum((x - mean) ** 2 for x in historical_scores) / len(historical_scores)
        std_dev = variance ** 0.5
        
        if std_dev == 0:
            return current_score != mean
        
        # Check if current score is > 2 standard deviations from mean
        z_score = (current_score - mean) / std_dev
        return abs(z_score) > 2
    
    def compare_audits(
        self,
        current: dict[str, Any],
        previous: dict[str, Any],
    ) -> dict[str, Any]:
        """Compare two audits and highlight differences."""
        changes = []
        
        # Compare risk scores
        current_risk = current.get("risk_score", 0)
        previous_risk = previous.get("risk_score", 0)
        
        if abs(current_risk - previous_risk) > 0.05:
            direction = "increased" if current_risk > previous_risk else "decreased"
            changes.append({
                "field": "risk_score",
                "direction": direction,
                "previous": round(previous_risk, 4),
                "current": round(current_risk, 4),
                "change": round(current_risk - previous_risk, 4),
            })
        
        # Compare content quality
        current_quality = current.get("content_analysis", {}).get("quality_score", 0)
        previous_quality = previous.get("content_analysis", {}).get("quality_score", 0)
        
        if abs(current_quality - previous_quality) > 5:
            direction = "improved" if current_quality > previous_quality else "declined"
            changes.append({
                "field": "content_quality",
                "direction": direction,
                "previous": previous_quality,
                "current": current_quality,
            })
        
        # Compare ad count
        current_ads = current.get("ad_analysis", {}).get("ad_count", 0)
        previous_ads = previous.get("ad_analysis", {}).get("ad_count", 0)
        
        if abs(current_ads - previous_ads) >= 2:
            direction = "increased" if current_ads > previous_ads else "decreased"
            changes.append({
                "field": "ad_count",
                "direction": direction,
                "previous": previous_ads,
                "current": current_ads,
            })
        
        return {
            "has_changes": len(changes) > 0,
            "significant_changes": changes,
            "summary": self._generate_comparison_summary(changes),
        }
    
    def _generate_comparison_summary(self, changes: list[dict[str, Any]]) -> str:
        """Generate a summary of changes."""
        if not changes:
            return "No significant changes detected since last audit."
        
        summaries = []
        for change in changes:
            field = change["field"].replace("_", " ").title()
            direction = change["direction"]
            summaries.append(f"{field} has {direction}")
        
        return "; ".join(summaries) + "."


# Convenience instance
trend_analyzer = TrendAnalyzer()
