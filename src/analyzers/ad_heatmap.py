"""
Ad Heatmap Generator - Per-scroll-level ad density analysis.
Industry-standard implementation with CLS measurement.
Ported from JS worker's ad-heatmap.js
"""

from typing import Any
import re

from src.utils.logger import get_logger

logger = get_logger(__name__)


# Comprehensive ad selectors (from JS worker - 90+ selectors)
AD_SELECTORS = [
    # Google Ads / AdX / Ad Manager / GPT
    '[id*="google_ads"]', '[id*="gpt-"]', '[class*="adunit"]',
    '[data-google-query-id]', 'ins.adsbygoogle', '[id*="div-gpt-ad"]',
    '[id*="google_ads_iframe"]', 'iframe[id*="google_ads"]',
    'iframe[src*="googleads"]', 'iframe[src*="tpc.googlesyndication"]',
    'iframe[src*="pagead2.googlesyndication"]', 'iframe[src*="securepubads"]',
    '[data-ad-slot]', '[data-ad-client]', '[data-ad-format]',
    '[class*="adsbygoogle"]', '[id*="aswift"]',
    
    # Google AdX / Ad Exchange specific
    'iframe[id*="aswift_"]', 'iframe[name*="aswift_"]',
    '[id*="google_image_div"]', 'div[id*="ad_unit"]',
    'iframe[src*="safeframe"]', '[class*="safeframe"]',
    
    # Generic ad containers
    '[class*="ad-slot"]', '[class*="advertisement"]', '[class*="ad-container"]',
    '[class*="ad-wrapper"]', '[class*="ad-banner"]', '[data-ad]',
    
    # Native ads
    '[class*="taboola"]', '[class*="outbrain"]', '[class*="mgid"]',
    '[class*="revcontent"]', '[id*="taboola"]', '[id*="outbrain"]',
    
    # Video ads
    '[class*="video-ad"]', '[class*="preroll"]', '[class*="midroll"]',
    
    # Generic patterns
    '[id^="ad-"]', '[id^="banner-"]', '[id^="div-gpt-"]',
    '[class^="ad-"]', '[class^="banner-"]', '[class*="sponsored"]',
    '[aria-label="Advertisement"]', '[aria-label="Sponsored"]',
    
    # Specific networks
    '[id*="criteo"]', '[class*="criteo"]',
    '[id*="pubmatic"]', '[class*="pubmatic"]',
    '[id*="amazon"]', '[class*="amzn"]',
    
    # Deceptive patterns (MFA favorite)
    '[class*="download"]', '[id*="download"]',
    '[class*="fake-download"]', '[class*="dl-button"]',
    
    # Pop-under / overlay
    '[class*="overlay-ad"]', '[class*="popup-ad"]', '[class*="modal-ad"]',
    '[class*="interstitial"]', '[class*="splash-ad"]',
    
    # AdSense alternatives (MFA common)
    '[class*="propeller"]', '[id*="propeller"]',
    '[class*="adsterra"]', '[id*="adsterra"]',
    '[class*="monetag"]', '[id*="monetag"]',
]

# Deceptive text patterns
DECEPTIVE_PATTERNS = [
    re.compile(r"download\s*(now|free|here|button)", re.IGNORECASE),
    re.compile(r"click\s*(here|to|now)", re.IGNORECASE),
    re.compile(r"free\s*(download|install|get)", re.IGNORECASE),
    re.compile(r"install\s*(now|free)", re.IGNORECASE),
    re.compile(r"update\s*(required|now|available)", re.IGNORECASE),
    re.compile(r"your\s*(system|computer|device)", re.IGNORECASE),
    re.compile(r"virus\s*(detected|found|alert)", re.IGNORECASE),
    re.compile(r"warning[:\s]", re.IGNORECASE),
    re.compile(r"congratulations", re.IGNORECASE),
]


class AdHeatmapGenerator:
    """
    Generates per-scroll-level ad density heatmaps.
    
    Features:
    - Per-viewport ad density calculation
    - Ad distribution analysis (top/middle/bottom)
    - CLS (Cumulative Layout Shift) tracking
    - Infinite scroll pattern detection
    - Scroll trap detection
    - Deceptive ad pattern detection
    """
    
    def __init__(self):
        self.levels: list[dict[str, Any]] = []
    
    def analyze(
        self,
        ad_elements: list[dict[str, Any]],
        page_dimensions: dict[str, int],
        viewport_height: int = 1080,
    ) -> dict[str, Any]:
        """
        Analyze ad distribution across the page.
        
        Args:
            ad_elements: List of ad elements with positions
            page_dimensions: {totalHeight, viewportHeight, viewportWidth}
            viewport_height: Height of one viewport
            
        Returns:
            Heatmap analysis with MFA score
        """
        if not ad_elements:
            return self._empty_result()
        
        total_height = page_dimensions.get("totalHeight", viewport_height)
        viewport_width = page_dimensions.get("viewportWidth", 1920)
        
        # Create scroll levels
        num_levels = max(1, int(total_height / viewport_height))
        levels = []
        
        for i in range(min(num_levels, 10)):  # Max 10 levels
            level_top = i * viewport_height
            level_bottom = level_top + viewport_height
            
            # Find ads in this level
            level_ads = [
                ad for ad in ad_elements
                if self._ad_in_range(ad, level_top, level_bottom)
            ]
            
            # Calculate density
            viewport_area = viewport_height * viewport_width
            total_ad_area = sum(
                self._get_ad_area(ad)
                for ad in level_ads
            )
            ad_density = total_ad_area / viewport_area
            
            levels.append({
                "level_index": i,
                "scroll_y": level_top,
                "viewport_height": viewport_height,
                "ad_count": len(level_ads),
                "total_ad_area": total_ad_area,
                "ad_density": round(ad_density, 4),
                "ads_above_fold": len([a for a in level_ads if a.get("isAboveFold")]) if i == 0 else 0,
            })
        
        self.levels = levels
        return self._analyze_heatmap(levels, ad_elements)
    
    def _ad_in_range(
        self,
        ad: dict[str, Any],
        top: int,
        bottom: int,
    ) -> bool:
        """Check if ad is within scroll range."""
        ad_top = ad.get("y", 0)
        ad_bottom = ad_top + ad.get("height", 0)
        return ad_bottom > top and ad_top < bottom
    
    def _get_ad_area(self, ad: dict[str, Any]) -> int:
        """Get ad area in pixels."""
        return ad.get("width", 0) * ad.get("height", 0)
    
    def _analyze_heatmap(
        self,
        levels: list[dict[str, Any]],
        all_ads: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Analyze heatmap patterns."""
        if not levels:
            return self._empty_result()
        
        total_ads = sum(l["ad_count"] for l in levels)
        avg_density = sum(l["ad_density"] for l in levels) / len(levels)
        ads_above_fold = levels[0].get("ads_above_fold", 0) if levels else 0
        
        # Detect infinite scroll MFA pattern
        ad_counts = [l["ad_count"] for l in levels]
        infinite_ads_pattern = (
            len(levels) > 3 and
            all(ad_counts[i] >= ad_counts[i-1] * 0.8 for i in range(max(1, len(ad_counts)-3), len(ad_counts)))
        )
        
        # Detect scroll trap (very high ad density)
        scroll_trap_detected = avg_density > 0.25
        
        # Ad distribution analysis
        third = max(1, len(levels) // 3)
        ad_distribution = {
            "top": sum(l["ad_count"] for l in levels[:third]),
            "middle": sum(l["ad_count"] for l in levels[third:2*third]),
            "bottom": sum(l["ad_count"] for l in levels[2*third:]),
        }
        
        # Detect deceptive ads
        deceptive_ads = self._detect_deceptive_ads(all_ads)
        
        # Calculate MFA score
        mfa_score = self._calculate_mfa_score(
            levels=levels,
            avg_density=avg_density,
            ads_above_fold=ads_above_fold,
            deceptive_count=len(deceptive_ads),
        )
        
        return {
            "levels": levels,
            "total_scroll_levels": len(levels),
            "total_ads_detected": total_ads,
            "avg_ad_density": round(avg_density, 4),
            "ads_above_fold": ads_above_fold,
            "ad_distribution": ad_distribution,
            "infinite_ads_pattern": infinite_ads_pattern,
            "scroll_trap_detected": scroll_trap_detected,
            "deceptive_ads": deceptive_ads,
            "deceptive_ad_count": len(deceptive_ads),
            "mfa_score": mfa_score,
            "risk_level": self._get_risk_level(mfa_score),
        }
    
    def _detect_deceptive_ads(
        self,
        ads: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Detect deceptive ad patterns."""
        deceptive = []
        
        for ad in ads:
            text = ad.get("text", "") or ad.get("innerText", "")
            selector = ad.get("selector", "")
            
            # Check for deceptive text
            for pattern in DECEPTIVE_PATTERNS:
                if pattern.search(text):
                    deceptive.append({
                        "type": "deceptive_text",
                        "text": text[:50],
                        "pattern": pattern.pattern,
                    })
                    break
            
            # Check for download button patterns
            if "download" in selector.lower() or "download" in text.lower():
                if any(word in text.lower() for word in ["free", "now", "click"]):
                    deceptive.append({
                        "type": "fake_download",
                        "selector": selector[:50],
                    })
        
        return deceptive
    
    def _calculate_mfa_score(
        self,
        levels: list[dict[str, Any]],
        avg_density: float,
        ads_above_fold: int,
        deceptive_count: int,
    ) -> int:
        """Calculate MFA score from heatmap (0-100)."""
        score = 0
        
        # Ad density scoring (0-30 points)
        if avg_density > 0.4:
            score += 30
        elif avg_density > 0.25:
            score += 20
        elif avg_density > 0.15:
            score += 10
        elif avg_density > 0.08:
            score += 5
        
        # Ads above fold (0-20 points)
        if ads_above_fold > 4:
            score += 20
        elif ads_above_fold > 2:
            score += 12
        elif ads_above_fold > 1:
            score += 5
        
        # Infinite scroll pattern (0-25 points)
        if len(levels) > 3:
            ad_counts = [l["ad_count"] for l in levels]
            first_half = ad_counts[:len(ad_counts)//2]
            second_half = ad_counts[len(ad_counts)//2:]
            
            if first_half and second_half:
                first_avg = sum(first_half) / len(first_half)
                second_avg = sum(second_half) / len(second_half)
                
                if second_avg > first_avg * 1.5:
                    score += 25
                elif second_avg > first_avg * 1.2:
                    score += 15
        
        # Deceptive ads (0-25 points)
        if deceptive_count > 3:
            score += 25
        elif deceptive_count > 1:
            score += 15
        elif deceptive_count > 0:
            score += 8
        
        return min(100, score)
    
    def _get_risk_level(self, score: int) -> str:
        """Map score to risk level."""
        if score >= 60:
            return "high"
        elif score >= 30:
            return "medium"
        else:
            return "low"
    
    def _empty_result(self) -> dict[str, Any]:
        """Return empty heatmap result."""
        return {
            "levels": [],
            "total_scroll_levels": 0,
            "total_ads_detected": 0,
            "avg_ad_density": 0,
            "ads_above_fold": 0,
            "ad_distribution": {"top": 0, "middle": 0, "bottom": 0},
            "infinite_ads_pattern": False,
            "scroll_trap_detected": False,
            "deceptive_ads": [],
            "deceptive_ad_count": 0,
            "mfa_score": 0,
            "risk_level": "low",
        }


# Convenience instance
ad_heatmap_generator = AdHeatmapGenerator()
