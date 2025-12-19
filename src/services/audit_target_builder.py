"""
Audit Target Builder - Selects high-priority URLs for auditing based on GAM data.

Instead of auditing just the homepage, this service identifies:
1. Top revenue URLs from GAM data
2. CTR anomaly pages (potential MFA)
3. High-traffic directory paths
"""

from typing import Any
from src.utils.logger import get_logger

logger = get_logger(__name__)


# High eCPM topics that indicate MFA risk
HIGH_ECPM_TOPICS = [
    "health", "insurance", "loan", "mortgage", "legal", "lawyer",
    "finance", "crypto", "bitcoin", "forex", "trading", "investment",
    "education", "degree", "online course", "weight loss", "diet",
]

# MFA-indicator path patterns
MFA_PATH_PATTERNS = [
    "/health/", "/education/", "/insurance/", "/loan/", "/legal/",
    "/crypto/", "/finance/", "/news/", "/amp/", "/tag/", "/category/",
]


class AuditTargetBuilder:
    """
    Builds prioritized audit targets from GAM data.
    
    Instead of auditing random URLs, this identifies:
    - Top revenue generating paths
    - CTR anomalies (high CTR + low eCPM = MFA signal)
    - Directory paths with high ad density
    """
    
    def __init__(self, gam_data: list[dict[str, Any]] | None = None):
        """
        Initialize with optional GAM data.
        
        Args:
            gam_data: List of GAM report records (from reports_dimensional)
        """
        self.gam_data = gam_data or []
    
    def build_targets(
        self,
        site_name: str,
        max_targets: int = 5,
        include_homepage: bool = True,
    ) -> list[dict[str, Any]]:
        """
        Build prioritized list of audit targets.
        
        Args:
            site_name: Base site name (e.g., "example.com")
            max_targets: Maximum number of targets to return
            include_homepage: Whether to include homepage in targets
            
        Returns:
            List of audit targets with URL and reason
        """
        targets = []
        
        # Always start with homepage if requested
        if include_homepage:
            homepage_url = f"https://{site_name}"
            targets.append({
                "url": homepage_url,
                "site": site_name,
                "reason": "homepage",
                "priority": 1,
            })
        
        # If we have GAM data, analyze it for high-value targets
        if self.gam_data:
            gam_targets = self._analyze_gam_data(site_name)
            targets.extend(gam_targets)
        else:
            # Without GAM data, generate targets from common MFA paths
            mfa_targets = self._generate_mfa_path_targets(site_name)
            targets.extend(mfa_targets)
        
        # Deduplicate and limit
        seen_urls = set()
        unique_targets = []
        for target in targets:
            if target["url"] not in seen_urls:
                seen_urls.add(target["url"])
                unique_targets.append(target)
        
        # Sort by priority and limit
        unique_targets.sort(key=lambda x: x.get("priority", 999))
        return unique_targets[:max_targets]
    
    def _analyze_gam_data(self, site_name: str) -> list[dict[str, Any]]:
        """Analyze GAM data to find high-value audit targets."""
        targets = []
        
        # Group by URL/path if available
        url_stats: dict[str, dict[str, float]] = {}
        
        for record in self.gam_data:
            # Try to get URL or path from record
            page_url = record.get("page_url") or record.get("ad_unit_path", "")
            
            if not page_url:
                continue
            
            if page_url not in url_stats:
                url_stats[page_url] = {
                    "revenue": 0,
                    "impressions": 0,
                    "clicks": 0,
                    "ctr_sum": 0,
                    "count": 0,
                }
            
            stats = url_stats[page_url]
            stats["revenue"] += float(record.get("revenue", 0))
            stats["impressions"] += int(record.get("impressions", 0))
            stats["clicks"] += int(record.get("clicks", 0))
            stats["ctr_sum"] += float(record.get("ctr", 0))
            stats["count"] += 1
        
        # Find anomalies
        for url, stats in url_stats.items():
            if stats["count"] == 0:
                continue
            
            avg_ctr = stats["ctr_sum"] / stats["count"]
            
            # High revenue target
            if stats["revenue"] > 100:  # $100+ revenue
                full_url = self._to_full_url(url, site_name)
                targets.append({
                    "url": full_url,
                    "site": site_name,
                    "reason": "high_revenue",
                    "revenue": stats["revenue"],
                    "priority": 2,
                })
            
            # CTR anomaly (potential clickbait/MFA)
            if avg_ctr > 0.02:  # >2% CTR is high
                full_url = self._to_full_url(url, site_name)
                targets.append({
                    "url": full_url,
                    "site": site_name,
                    "reason": "high_ctr_anomaly",
                    "ctr": avg_ctr,
                    "priority": 3,
                })
        
        return targets
    
    def _generate_mfa_path_targets(self, site_name: str) -> list[dict[str, Any]]:
        """Generate targets from common MFA path patterns."""
        targets = []
        
        # Common MFA directory paths to check
        paths_to_check = [
            "/health/",
            "/news/",
            "/education/",
            "/category/",
            "/tag/",
        ]
        
        for i, path in enumerate(paths_to_check):
            targets.append({
                "url": f"https://{site_name}{path}",
                "site": site_name,
                "reason": "mfa_path_pattern",
                "path": path,
                "priority": 10 + i,  # Lower priority than GAM-based
            })
        
        return targets
    
    def _to_full_url(self, url_or_path: str, site_name: str) -> str:
        """Convert a path or partial URL to a full URL."""
        if url_or_path.startswith("http"):
            return url_or_path
        elif url_or_path.startswith("/"):
            return f"https://{site_name}{url_or_path}"
        else:
            return f"https://{site_name}/{url_or_path}"
    
    def compute_mfa_flags(self) -> dict[str, Any]:
        """
        Compute MFA detection flags from GAM data.
        
        Returns deterministic flags (not AI-generated):
        - mfa_classic: High CTR + low eCPM
        - clickbait: Very high CTR
        - ad_farming: High refresh + low session
        """
        if not self.gam_data:
            return {"has_data": False}
        
        # Aggregate metrics
        total_revenue = sum(float(r.get("revenue", 0)) for r in self.gam_data)
        total_impressions = sum(int(r.get("impressions", 0)) for r in self.gam_data)
        total_clicks = sum(int(r.get("clicks", 0)) for r in self.gam_data)
        
        # Calculate averages
        avg_ctr = (total_clicks / total_impressions * 100) if total_impressions > 0 else 0
        avg_ecpm = (total_revenue / total_impressions * 1000) if total_impressions > 0 else 0
        
        # Compute flags
        flags = {
            "has_data": True,
            "total_revenue": total_revenue,
            "total_impressions": total_impressions,
            "avg_ctr": round(avg_ctr, 2),
            "avg_ecpm": round(avg_ecpm, 2),
            
            # MFA Classic: High CTR + Low eCPM
            "mfa_classic": avg_ctr > 1.0 and avg_ecpm < 1.0,
            
            # Clickbait: Very high CTR
            "clickbait_signal": avg_ctr > 3.0,
            
            # Low quality: Low eCPM despite traffic
            "low_quality_signal": avg_ecpm < 0.5 and total_impressions > 10000,
        }
        
        # Risk level
        risk_count = sum([
            flags["mfa_classic"],
            flags["clickbait_signal"],
            flags["low_quality_signal"],
        ])
        
        flags["gam_risk_level"] = (
            "critical" if risk_count >= 2 else
            "high" if risk_count == 1 else
            "low"
        )
        
        return flags
