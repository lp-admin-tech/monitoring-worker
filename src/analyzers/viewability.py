"""
Ad Viewability Checker - MRC-compliant viewability analysis.
Industry-standard implementation aligned with MRC/IAB viewability guidelines.
Ported from JS worker's visibility.js
"""

from typing import Any

from src.utils.logger import get_logger

logger = get_logger(__name__)


# MRC Viewability Standards
MRC_STANDARDS = {
    "display": 0.5,   # 50% of pixels in view for 1 second
    "video": 0.5,     # 50% of pixels in view for 2 seconds
    "native": 0.5,
}


class ViewabilityChecker:
    """
    MRC-compliant ad viewability analysis.
    
    Aligned with:
    - MRC Viewability Standards (2014, updated 2024)
    - IAB Display Impression Measurement Guidelines
    - Industry verification standards (IAS, DV, Moat)
    
    Features:
    - Intersection ratio calculation
    - Above-the-fold detection
    - Hidden ad detection
    - Viewability categorization
    - Compliance scoring
    """
    
    def __init__(self, min_visibility_ratio: float = 0.5):
        self.min_visibility_ratio = min_visibility_ratio
        self.viewport_padding = 50
    
    def analyze(
        self,
        ad_elements: list[dict[str, Any]],
        viewport: dict[str, int] | None = None,
    ) -> dict[str, Any]:
        """
        Analyze ad viewability.
        
        Args:
            ad_elements: List of ad elements with bounding boxes
            viewport: Viewport dimensions {width, height}
            
        Returns:
            Viewability analysis with MRC compliance metrics
        """
        if viewport is None:
            viewport = {"width": 1920, "height": 1080}
        
        if not ad_elements:
            return self._empty_result()
        
        # Analyze each ad
        analyzed_ads = [
            self._analyze_ad(ad, viewport)
            for ad in ad_elements
        ]
        
        # Categorize by viewability
        categorized = self._categorize_by_viewability(analyzed_ads)
        
        # Calculate metrics
        metrics = self._calculate_metrics(categorized)
        
        # Identify issues
        issues = self._identify_issues(categorized)
        
        # Detect hidden ads
        hidden = self._detect_hidden_ads(analyzed_ads)
        
        return {
            "metrics": metrics,
            "categorization": {
                "viewable": [
                    {"id": a.get("id"), "ratio": a["intersection_ratio"]}
                    for a in categorized["viewable"]
                ],
                "partially_viewable": [
                    {"id": a.get("id"), "ratio": a["intersection_ratio"]}
                    for a in categorized["partially_viewable"]
                ],
                "not_viewable": [
                    {"id": a.get("id"), "reason": "offscreen"}
                    for a in categorized["not_viewable"]
                ],
            },
            "hidden_ads": hidden,
            "issues": issues,
            "summary": {
                "mrc_compliant": metrics["viewable_percentage"] >= 50,
                "compliance_status": "compliant" if metrics["viewable_percentage"] >= 50 else "non_compliant",
                "recommended_actions": self._get_recommendations(metrics),
            },
        }
    
    def _analyze_ad(
        self,
        ad: dict[str, Any],
        viewport: dict[str, int],
    ) -> dict[str, Any]:
        """Analyze a single ad element."""
        bbox = ad.get("boundingBox", {})
        
        # Calculate intersection ratio
        intersection_ratio = self._calculate_intersection_ratio(bbox, viewport)
        
        # Determine viewability
        is_viewable = intersection_ratio >= self.min_visibility_ratio
        is_above_fold = bbox.get("top", 0) <= 600
        z_index = ad.get("zIndex")
        has_valid_z_index = z_index is None or z_index >= 0
        
        return {
            "id": ad.get("id"),
            "type": ad.get("type", "display"),
            "position": {
                "x": bbox.get("left", 0),
                "y": bbox.get("top", 0),
                "width": bbox.get("right", 0) - bbox.get("left", 0),
                "height": bbox.get("bottom", 0) - bbox.get("top", 0),
            },
            "intersection_ratio": round(intersection_ratio, 3),
            "is_viewable": is_viewable and has_valid_z_index,
            "is_above_fold": is_above_fold,
            "occluded": not has_valid_z_index,
            "visibility": "visible" if is_viewable else "offscreen",
            "iframe_depth": ad.get("iframeDepth", 0),
            "hidden_by_css": ad.get("display") == "none" or ad.get("visibility") == "hidden",
        }
    
    def _calculate_intersection_ratio(
        self,
        bbox: dict[str, Any],
        viewport: dict[str, int],
    ) -> float:
        """Calculate intersection ratio with viewport (MRC standard)."""
        if not bbox:
            return 0
        
        top = bbox.get("top", 0)
        left = bbox.get("left", 0)
        right = bbox.get("right", 0)
        bottom = bbox.get("bottom", 0)
        
        viewport_bottom = viewport["height"]
        viewport_right = viewport["width"]
        
        # Calculate intersection
        int_top = max(top, 0)
        int_left = max(left, 0)
        int_bottom = min(bottom, viewport_bottom)
        int_right = min(right, viewport_right)
        
        if int_top >= int_bottom or int_left >= int_right:
            return 0
        
        intersection_area = (int_right - int_left) * (int_bottom - int_top)
        element_area = (right - left) * (bottom - top)
        
        if element_area == 0:
            return 0
        
        return intersection_area / element_area
    
    def _categorize_by_viewability(
        self,
        ads: list[dict[str, Any]],
    ) -> dict[str, list[dict[str, Any]]]:
        """Categorize ads by viewability level."""
        viewable = []
        partially_viewable = []
        not_viewable = []
        
        for ad in ads:
            ratio = ad["intersection_ratio"]
            if ratio >= self.min_visibility_ratio:
                viewable.append(ad)
            elif ratio > 0:
                partially_viewable.append(ad)
            else:
                not_viewable.append(ad)
        
        return {
            "viewable": viewable,
            "partially_viewable": partially_viewable,
            "not_viewable": not_viewable,
        }
    
    def _calculate_metrics(
        self,
        categorized: dict[str, list[dict[str, Any]]],
    ) -> dict[str, Any]:
        """Calculate viewability metrics."""
        total = (
            len(categorized["viewable"]) +
            len(categorized["partially_viewable"]) +
            len(categorized["not_viewable"])
        )
        
        if total == 0:
            return {
                "total_ads": 0,
                "viewable_percentage": 0,
                "partially_viewable_percentage": 0,
                "not_viewable_percentage": 0,
            }
        
        return {
            "total_ads": total,
            "viewable_count": len(categorized["viewable"]),
            "partially_viewable_count": len(categorized["partially_viewable"]),
            "not_viewable_count": len(categorized["not_viewable"]),
            "viewable_percentage": round(
                len(categorized["viewable"]) / total * 100, 2
            ),
            "partially_viewable_percentage": round(
                len(categorized["partially_viewable"]) / total * 100, 2
            ),
            "not_viewable_percentage": round(
                len(categorized["not_viewable"]) / total * 100, 2
            ),
        }
    
    def _detect_hidden_ads(
        self,
        ads: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Detect hidden ads (potential fraud indicator)."""
        hidden = []
        
        for ad in ads:
            reasons = []
            
            if ad["intersection_ratio"] == 0:
                reasons.append("completely_offscreen")
            elif ad["intersection_ratio"] < self.min_visibility_ratio:
                reasons.append("partially_obscured")
            
            if ad.get("hidden_by_css"):
                reasons.append("hidden_by_css")
            
            if ad.get("occluded"):
                reasons.append("negative_z_index")
            
            if ad.get("iframe_depth", 0) > 3:
                reasons.append("deeply_nested")
            
            if reasons:
                hidden.append({
                    "id": ad.get("id"),
                    "reasons": reasons,
                    "intersection_ratio": ad["intersection_ratio"],
                })
        
        return hidden
    
    def _identify_issues(
        self,
        categorized: dict[str, list[dict[str, Any]]],
    ) -> list[dict[str, Any]]:
        """Identify viewability issues."""
        issues = []
        
        if categorized["not_viewable"]:
            issues.append({
                "severity": "high",
                "type": "hidden_ads",
                "message": f"{len(categorized['not_viewable'])} ads are completely hidden",
                "count": len(categorized["not_viewable"]),
            })
        
        low_viewability = [
            a for a in categorized["partially_viewable"]
            if a["intersection_ratio"] < 0.3
        ]
        if low_viewability:
            issues.append({
                "severity": "medium",
                "type": "low_viewability",
                "message": f"{len(low_viewability)} ads have very low viewability (<30%)",
                "count": len(low_viewability),
            })
        
        return issues
    
    def _get_recommendations(self, metrics: dict[str, Any]) -> list[str]:
        """Generate recommendations based on metrics."""
        if metrics["viewable_percentage"] >= 50:
            return []
        
        return [
            "Improve ad placement visibility",
            "Review ad slot positioning",
            "Consider reducing ad density to improve viewability",
        ]
    
    def _empty_result(self) -> dict[str, Any]:
        """Return empty result when no ads."""
        return {
            "metrics": {
                "total_ads": 0,
                "viewable_percentage": 0,
            },
            "categorization": {
                "viewable": [],
                "partially_viewable": [],
                "not_viewable": [],
            },
            "hidden_ads": [],
            "issues": [],
            "summary": {
                "mrc_compliant": True,
                "compliance_status": "no_ads",
                "recommended_actions": [],
            },
        }


# Convenience instance
viewability_checker = ViewabilityChecker()
