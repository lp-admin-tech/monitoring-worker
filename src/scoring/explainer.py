"""
Score Explainer - Generates human-readable explanations for risk scores.
Ported from JS worker's explanation.js
"""

from typing import Any

from src.utils.logger import get_logger

logger = get_logger(__name__)


# Risk factor explanations
FACTOR_EXPLANATIONS = {
    "behavioral": {
        "name": "Advertising Behavior",
        "high": "Site shows aggressive advertising patterns including high ad density and suspicious refresh behaviors.",
        "medium": "Site has elevated ad presence that warrants monitoring.",
        "low": "Advertising behavior appears within normal parameters.",
    },
    "content": {
        "name": "Content Quality",
        "high": "Content shows significant quality issues including thin content, clickbait patterns, or potential AI generation.",
        "medium": "Content quality is below average with some concerning patterns.",
        "low": "Content quality appears acceptable.",
    },
    "technical": {
        "name": "Technical Health",
        "high": "Technical issues detected including SSL problems, missing ads.txt, or poor performance.",
        "medium": "Some technical improvements recommended.",
        "low": "Technical implementation is sound.",
    },
    "gam_correlation": {
        "name": "GAM Metrics",
        "high": "GAM data shows suspicious patterns like unusually high CTR or very low eCPM.",
        "medium": "GAM metrics are outside normal ranges.",
        "low": "GAM metrics appear healthy.",
    },
    "layout": {
        "name": "Page Layout",
        "high": "Layout shows excessive ad placement or viewport occlusion issues.",
        "medium": "Layout could be improved for better user experience.",
        "low": "Layout provides good content visibility.",
    },
    "policy": {
        "name": "Policy Compliance",
        "high": "Potential policy violations detected in content.",
        "medium": "Some content may require review for policy compliance.",
        "low": "No policy concerns identified.",
    },
}


class ScoreExplainer:
    """
    Generates human-readable explanations for MFA risk scores.
    
    Provides:
    - Overall summary
    - Component breakdowns
    - Specific findings
    - Recommended actions
    """
    
    def explain(
        self,
        risk_score: float,
        mfa_probability: float,
        component_risks: dict[str, float],
        content_analysis: dict[str, Any] | None = None,
        ad_analysis: dict[str, Any] | None = None,
        technical_check: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Generate comprehensive explanation for risk scores.
        
        Returns:
            Explanation with summary, factors, and recommendations
        """
        risk_level = self._get_risk_level(mfa_probability)
        
        # Generate overall summary
        summary = self._generate_summary(mfa_probability, risk_level)
        
        # Explain each component
        factor_explanations = self._explain_components(component_risks)
        
        # Extract key findings
        key_findings = self._extract_key_findings(
            content_analysis or {},
            ad_analysis or {},
            technical_check or {},
        )
        
        # Generate recommendations
        recommendations = self._generate_recommendations(
            risk_level=risk_level,
            component_risks=component_risks,
            content_analysis=content_analysis or {},
            ad_analysis=ad_analysis or {},
            technical_check=technical_check or {},
        )
        
        return {
            "summary": summary,
            "risk_level": risk_level,
            "mfa_probability_percent": round(mfa_probability * 100, 1),
            "factor_explanations": factor_explanations,
            "key_findings": key_findings,
            "recommendations": recommendations,
            "confidence": self._calculate_confidence(component_risks),
        }
    
    def _generate_summary(self, probability: float, risk_level: str) -> str:
        """Generate overall risk summary."""
        percentage = probability * 100
        
        if risk_level == "high":
            return (
                f"This site shows a {percentage:.0f}% probability of being Made For Advertising (MFA). "
                "Multiple concerning patterns detected that suggest the site prioritizes ad revenue "
                "over providing genuine content value. Immediate review recommended."
            )
        elif risk_level == "medium":
            return (
                f"This site shows a {percentage:.0f}% probability of being Made For Advertising (MFA). "
                "Some concerning patterns detected that warrant monitoring. "
                "Consider reviewing specific issues identified."
            )
        else:
            return (
                f"This site shows a {percentage:.0f}% probability of being Made For Advertising (MFA). "
                "The site appears to maintain an acceptable balance between content and advertising. "
                "No immediate action required."
            )
    
    def _explain_components(
        self,
        component_risks: dict[str, float],
    ) -> list[dict[str, Any]]:
        """Explain each risk component."""
        explanations = []
        
        for component, risk in component_risks.items():
            if component not in FACTOR_EXPLANATIONS:
                continue
            
            factor_info = FACTOR_EXPLANATIONS[component]
            risk_level = self._get_component_level(risk)
            
            explanations.append({
                "component": component,
                "name": factor_info["name"],
                "risk_score": round(risk, 4),
                "risk_level": risk_level,
                "explanation": factor_info[risk_level],
            })
        
        # Sort by risk score descending
        explanations.sort(key=lambda x: x["risk_score"], reverse=True)
        
        return explanations
    
    def _extract_key_findings(
        self,
        content: dict[str, Any],
        ads: dict[str, Any],
        technical: dict[str, Any],
    ) -> list[str]:
        """Extract key findings from analysis results."""
        findings = []
        
        # Content findings
        if content.get("thin_content", {}).get("is_thin"):
            findings.append("Thin content detected - pages have insufficient substantive text")
        
        if content.get("clickbait_score", 0) > 0.5:
            findings.append("Clickbait patterns detected in headlines and content")
        
        if content.get("ai_likelihood", 0) > 0.7:
            findings.append("Content shows characteristics of AI generation")
        
        if content.get("quality_score", 100) < 40:
            findings.append(f"Content quality score is low ({content.get('quality_score')}/100)")
        
        # Ad findings
        if ads.get("ad_count", 0) > 8:
            findings.append(f"Excessive ad units detected ({ads.get('ad_count')} ads)")
        
        if ads.get("density", {}).get("is_excessive"):
            findings.append("Ad density exceeds acceptable thresholds")
        
        patterns = ads.get("suspicious_patterns", [])
        high_patterns = [p for p in patterns if p.get("severity") == "high"]
        if high_patterns:
            findings.append(f"Detected {len(high_patterns)} high-severity ad patterns")
        
        # Technical findings
        if not technical.get("ssl", {}).get("valid"):
            findings.append("SSL certificate issues detected")
        
        if not technical.get("ads_txt", {}).get("present"):
            findings.append("No ads.txt file found")
        
        if technical.get("health_score", 100) < 50:
            findings.append("Technical health score is below acceptable threshold")
        
        return findings
    
    def _generate_recommendations(
        self,
        risk_level: str,
        component_risks: dict[str, float],
        content_analysis: dict[str, Any],
        ad_analysis: dict[str, Any],
        technical_check: dict[str, Any],
    ) -> list[str]:
        """Generate actionable recommendations."""
        recommendations = []
        
        # Content recommendations
        if component_risks.get("content", 0) > 0.5:
            recommendations.append(
                "Improve content quality by adding more in-depth, original articles"
            )
            
            if content_analysis.get("thin_content", {}).get("is_thin"):
                recommendations.append(
                    "Increase article length and depth - aim for 500+ words of substantive content"
                )
        
        # Ad recommendations
        if component_risks.get("behavioral", 0) > 0.5:
            ad_count = ad_analysis.get("ad_count", 0)
            if ad_count > 6:
                recommendations.append(
                    f"Reduce ad count from {ad_count} to 4-6 units maximum"
                )
            
            if ad_analysis.get("density", {}).get("is_excessive"):
                recommendations.append(
                    "Improve ad-to-content ratio by reducing ads or adding more content"
                )
        
        # Technical recommendations
        if not technical_check.get("ssl", {}).get("valid"):
            recommendations.append(
                "Install and configure a valid SSL certificate"
            )
        
        if not technical_check.get("ads_txt", {}).get("present"):
            recommendations.append(
                "Add an ads.txt file listing authorized ad sellers"
            )
        
        # General recommendations based on risk level
        if risk_level == "high":
            recommendations.append(
                "Conduct a comprehensive site review focusing on user experience vs ad placement"
            )
        elif risk_level == "medium":
            recommendations.append(
                "Monitor site metrics and address the specific issues identified"
            )
        
        return recommendations[:6]  # Limit to 6 recommendations
    
    def _get_risk_level(self, probability: float) -> str:
        """Map probability to risk level."""
        if probability >= 0.7:
            return "high"
        elif probability >= 0.4:
            return "medium"
        else:
            return "low"
    
    def _get_component_level(self, risk: float) -> str:
        """Map component risk to level."""
        if risk >= 0.6:
            return "high"
        elif risk >= 0.3:
            return "medium"
        else:
            return "low"
    
    def _calculate_confidence(self, component_risks: dict[str, float]) -> str:
        """Estimate confidence in the assessment."""
        # More components analyzed = higher confidence
        if len(component_risks) >= 5:
            return "high"
        elif len(component_risks) >= 3:
            return "medium"
        else:
            return "low"


# Convenience instance
score_explainer = ScoreExplainer()
