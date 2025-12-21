"""
Ad Analyzer - Detects and analyzes advertising patterns for MFA detection.
"""

from typing import Any

from src.utils.logger import get_logger
from src.crawlers.audit_crawler import CrawlResult

logger = get_logger(__name__)


class AdAnalyzer:
    """
    Analyzes advertising patterns on a page:
    - Ad density (ads per viewport, ads-to-content ratio)
    - Ad placement patterns
    - Auto-refresh detection
    - Scroll-triggered ad injection
    - Video ad analysis
    """
    
    # Suspiciously high thresholds
    MAX_NORMAL_AD_DENSITY = 0.3  # 30% of page
    MAX_NORMAL_AD_COUNT = 6
    
    async def analyze(self, crawl_result: CrawlResult) -> dict[str, Any]:
        """Analyze ad patterns from crawl result."""
        logger.info("Analyzing ads", url=crawl_result.url)
        
        try:
            ad_elements = crawl_result.ad_elements or []
            stacked_ads = getattr(crawl_result, "stacked_ads", []) or []
            ad_requests = crawl_result.ad_requests or []
            iframes = crawl_result.iframes or []
            scripts = crawl_result.scripts or []
            video_elements = getattr(crawl_result, "video_elements", []) or []
            
            # Count ads
            ad_count = len(ad_elements)
            ad_request_count = len(ad_requests)
            
            if ad_count == 0:
                logger.info("No ad elements detected by JS extraction", url=crawl_result.url)
            
            # Identify ad iframes
            ad_iframes = [
                iframe for iframe in iframes
                if self._is_ad_iframe(iframe.get("src", ""))
            ]
            
            # Calculate ad density metrics
            density_metrics = self._calculate_density(
                ad_count=ad_count,
                ad_elements=ad_elements,
                total_elements=len(crawl_result.links) + len(crawl_result.images),
                text_length=len(crawl_result.text or ""),
                viewport_height=crawl_result.layout.get("viewportHeight", 1080),
            )
            
            # Identify ad networks
            ad_networks = self._identify_networks(ad_requests)
            
            # Detect suspicious patterns
            suspicious_patterns = self._detect_suspicious_patterns(
                ad_count=ad_count,
                ad_request_count=ad_request_count,
                scripts=scripts,
                stacked_ads=stacked_ads,
            )
            
            # Analyze video players (MFA indicator)
            video_analysis = self._analyze_video_players(video_elements)
            
            # Calculate ad risk score
            risk_score = self._calculate_risk_score(
                ad_count=ad_count,
                density=density_metrics["ad_density"],
                suspicious_patterns=suspicious_patterns,
                ad_request_count=ad_request_count,
            )
            
            # Add video risk to overall risk
            risk_score = min(1.0, risk_score + video_analysis.get("risk_score", 0) * 0.3)
            
            # Calculate layout risk (real live data)
            layout_risk = self._calculate_layout_risk(ad_elements, stacked_ads)
            
            return {
                "ad_count": ad_count,
                "ad_request_count": ad_request_count,
                "ad_iframe_count": len(ad_iframes),
                "stacked_ads_count": len(stacked_ads),
                
                "density": density_metrics,
                "ad_networks": ad_networks,
                
                "suspicious_patterns": suspicious_patterns,
                
                # Video analysis
                "video_analysis": video_analysis,
                "video_count": video_analysis.get("video_count", 0),
                "video_stuffing": video_analysis.get("video_stuffing", False),
                "muted_autoplay": video_analysis.get("muted_autoplay", False),
                "sticky_videos": video_analysis.get("sticky_videos", 0),
                
                # Position metrics (from new crawler stats)
                "ads_above_fold": crawl_result.stats.get("adsAboveFold", 0),
                "sticky_ads": crawl_result.stats.get("stickyAds", 0),
                "hidden_ads": crawl_result.stats.get("hiddenAds", 0),
                
                # Popup/interstitial analysis
                "popup_count": crawl_result.stats.get("totalPopups", 0),
                "interstitial_count": crawl_result.stats.get("interstitials", 0),
                
                # Native widgets (traffic arbitrage signal)
                "native_widget_count": len(crawl_result.native_widgets) if hasattr(crawl_result, "native_widgets") else 0,
                
                "risk_score": round(risk_score, 2),
                "layout_risk": round(layout_risk, 2),
                "risk_level": self._get_risk_level(risk_score),
            }
            
        except Exception as e:
            logger.error("Ad analysis failed", error=str(e))
            return self._empty_result(error=str(e))
    
    def _is_ad_iframe(self, src: str) -> bool:
        """Check if an iframe source is ad-related."""
        ad_domains = [
            "googlesyndication.com",
            "doubleclick.net",
            "googleads",
            "adnxs.com",
            "facebook.com/plugins",
            "taboola",
            "outbrain",
        ]
        src_lower = src.lower()
        return any(domain in src_lower for domain in ad_domains)
    
    def _calculate_density(
        self,
        ad_count: int,
        ad_elements: list[dict[str, Any]],
        total_elements: int,
        text_length: int,
        viewport_height: int = 1080,
    ) -> dict[str, Any]:
        """Calculate ad density metrics."""
        # Ad to element ratio
        element_ratio = ad_count / max(total_elements, 1)
        
        # Ads per 1000 characters of content
        ads_per_1k_chars = (ad_count * 1000) / max(text_length, 1)
        
        # Area-based density (total ad pixels vs. total viewport pixels)
        # We assume a standard width of 1920 if not provided
        viewport_area = 1920 * viewport_height
        ad_area = sum(ad.get("width", 0) * ad.get("height", 0) for ad in ad_elements if ad.get("visible", True))
        area_density = ad_area / max(viewport_area, 1)
        
        # Overall density score (0-1)
        density = min((element_ratio + ads_per_1k_chars / 10 + area_density * 2) / 3, 1.0)
        
        return {
            "ad_density": round(density, 3),
            "element_ratio": round(element_ratio, 3),
            "ads_per_1k_chars": round(ads_per_1k_chars, 2),
            "area_density": round(area_density, 3),
            "is_excessive": density > self.MAX_NORMAL_AD_DENSITY or area_density > 0.4,
        }
    
    def _identify_networks(self, ad_requests: list[dict[str, Any]]) -> list[str]:
        """Get unique ad networks from requests."""
        networks = set()
        for req in ad_requests:
            network = req.get("ad_network", "")
            if network:
                # Clean up network name
                network = network.replace(".com", "").replace(".net", "")
                networks.add(network)
        return list(networks)
    
    def _detect_suspicious_patterns(
        self,
        ad_count: int,
        ad_request_count: int,
        scripts: list[str],
        stacked_ads: list[dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        """Detect suspicious advertising patterns."""
        patterns = []
        
        # Excessive ads
        if ad_count > self.MAX_NORMAL_AD_COUNT:
            patterns.append({
                "type": "excessive_ads",
                "description": f"Found {ad_count} ad elements (threshold: {self.MAX_NORMAL_AD_COUNT})",
                "severity": "high",
            })
        
        # Ad stacking
        if stacked_ads and len(stacked_ads) > 0:
            patterns.append({
                "type": "ad_stacking",
                "description": f"Detected {len(stacked_ads)} instances of stacked/overlapping ads",
                "severity": "critical",
            })
        
        # Ad request to element ratio (many requests, few visible ads = hidden ads)
        if ad_request_count > 0 and ad_count > 0:
            ratio = ad_request_count / ad_count
            if ratio > 5:
                patterns.append({
                    "type": "hidden_ad_requests",
                    "description": f"High request/element ratio: {ratio:.1f}",
                    "severity": "medium",
                })
        
        # Check for known aggressive ad scripts
        aggressive_scripts = ["popunder", "popads", "exoclick", "propellerads"]
        for script in scripts:
            script_lower = script.lower()
            for aggressive in aggressive_scripts:
                if aggressive in script_lower:
                    patterns.append({
                        "type": "aggressive_ad_script",
                        "description": f"Found aggressive ad script: {aggressive}",
                        "severity": "high",
                    })
                    break
        
        return patterns
    
    def _calculate_risk_score(
        self,
        ad_count: int,
        density: float,
        suspicious_patterns: list[dict[str, Any]],
        ad_request_count: int,
    ) -> float:
        """Calculate overall ad risk score (0-1)."""
        score = 0.0
        
        # Ad count contribution (0-0.3)
        if ad_count > 10:
            score += 0.3
        elif ad_count > 6:
            score += 0.2
        elif ad_count > 3:
            score += 0.1
        
        # Density contribution (0-0.3)
        score += min(density, 0.3)
        
        # Suspicious patterns contribution (0-0.4)
        high_severity = sum(1 for p in suspicious_patterns if p["severity"] == "high")
        medium_severity = sum(1 for p in suspicious_patterns if p["severity"] == "medium")
        score += min(high_severity * 0.15 + medium_severity * 0.08, 0.4)
        
        return min(score, 1.0)
    
    def _get_risk_level(self, risk_score: float) -> str:
        """Map risk score to level."""
        if risk_score >= 0.7:
            return "high"
        elif risk_score >= 0.4:
            return "medium"
        else:
            return "low"
    
    def _calculate_layout_risk(self, ad_elements: list[dict[str, Any]], stacked_ads: list[dict[str, Any]] = None) -> float:
        """Calculate layout risk based on ad placement and visibility."""
        if not ad_elements:
            return 0.0
            
        risk = 0.0
        
        # 1. Above the fold density
        atf_ads = [ad for ad in ad_elements if ad.get("y", 0) < 1000]
        if len(atf_ads) > 3:
            risk += 0.3
        elif len(atf_ads) > 1:
            risk += 0.15
            
        # 2. Ad stacking (from crawler detection)
        if stacked_ads and len(stacked_ads) > 0:
            risk += min(len(stacked_ads) * 0.25, 0.6)
            
        # 3. Hidden ads (invisible but present)
        hidden_ads = [ad for ad in ad_elements if ad.get("isHidden", False)]
        if hidden_ads:
            risk += min(len(hidden_ads) * 0.15, 0.4)
            
        # 4. Large ads (occlusion)
        large_ads = [ad for ad in ad_elements if ad.get("width", 0) * ad.get("height", 0) > 300000]
        if large_ads:
            risk += 0.15
            
        return min(risk, 1.0)
    
    def _analyze_video_players(self, video_elements: list[dict[str, Any]]) -> dict[str, Any]:
        """Analyze video player behavior for MFA signals."""
        if not video_elements:
            return {
                "video_count": 0,
                "autoplay_count": 0,
                "muted_autoplay": False,
                "hidden_videos": 0,
                "sticky_videos": 0,
                "video_stuffing": False,
                "risk_score": 0,
            }
        
        video_count = len(video_elements)
        autoplay_count = sum(1 for v in video_elements if v.get("autoplay"))
        muted_count = sum(1 for v in video_elements if v.get("muted"))
        hidden_count = sum(1 for v in video_elements if v.get("isHidden"))
        sticky_count = sum(1 for v in video_elements if v.get("isSticky"))
        
        # Calculate video risk score
        risk_score = 0.0
        
        # Video stuffing: excessive video players
        video_stuffing = video_count > 5
        if video_stuffing:
            risk_score += 0.3
        
        # Muted autoplay: common MFA tactic for video ad revenue
        muted_autoplay = autoplay_count > 0 and muted_count > 0
        if muted_autoplay:
            risk_score += 0.25
        
        # Hidden videos: deceptive
        if hidden_count > 0:
            risk_score += min(hidden_count * 0.15, 0.3)
        
        # Excessive sticky videos
        if sticky_count > 2:
            risk_score += 0.2
        
        return {
            "video_count": video_count,
            "autoplay_count": autoplay_count,
            "muted_autoplay": muted_autoplay,
            "hidden_videos": hidden_count,
            "sticky_videos": sticky_count,
            "video_stuffing": video_stuffing,
            "risk_score": min(risk_score, 1.0),
        }

    def _empty_result(self, error: str | None = None) -> dict[str, Any]:
        """Return empty result structure."""
        return {
            "ad_count": 0,
            "ad_request_count": 0,
            "ad_iframe_count": 0,
            "density": {"ad_density": 0, "is_excessive": False},
            "ad_networks": [],
            "suspicious_patterns": [],
            "video_analysis": {
                "video_count": 0,
                "muted_autoplay": False,
                "video_stuffing": False,
            },
            "video_count": 0,
            "video_stuffing": False,
            "muted_autoplay": False,
            "sticky_videos": 0,
            "risk_score": 0,
            "layout_risk": 0,
            "risk_level": "low",
            "error": error,
        }
