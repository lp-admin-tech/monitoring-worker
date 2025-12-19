"""
Network Interceptor - Tracks and analyzes network requests for ad detection.
Industry-standard implementation aligned with IAS, Pixalate, DoubleVerify patterns.
Ported from JS worker's network-interceptor.js with enhancements.
"""

from typing import Any
from urllib.parse import urlparse
import re

from src.utils.logger import get_logger

logger = get_logger(__name__)


# Comprehensive ad network patterns (IAS/Pixalate standard)
AD_NETWORK_PATTERNS = [
    # Google (full coverage)
    r"googlesyndication\.com", r"googleadservices\.com", r"doubleclick\.net",
    r"googleads\.g\.doubleclick\.net", r"pagead2\.googlesyndication\.com",
    r"adservice\.google\.", r"googletag", r"securepubads",
    
    # Major SSPs
    r"pubmatic\.com", r"rubiconproject\.com", r"openx\.net", r"criteo\.",
    r"amazon-adsystem", r"adsystem\.", r"bidswitch\.net", r"casalemedia\.com",
    
    # Ad Exchanges
    r"adnxs\.com", r"appnexus\.com", r"indexexchange\.com", r"triplelift\.com",
    r"sharethrough\.com", r"teads\.tv", r"33across\.com", r"smartadserver\.com",
    
    # Native/Content Recommendation (key MFA indicator)
    r"taboola\.com", r"outbrain\.com", r"mgid\.com", r"revcontent\.com",
    r"content\.ad", r"zergnet\.com", r"nativo\.com",
    
    # Verification/Viewability (IAS, DV, Moat)
    r"moatads\.com", r"adsafeprotected\.com", r"iasds01\.com", r"doubleverify\.com",
    
    # Video Ad Servers
    r"spotxchange\.com", r"springserve\.com", r"jwpltx\.com",
    
    # Meta/Facebook
    r"facebook\.net.*pixel", r"facebook\.com/tr",
    
    # Amazon
    r"amazon-adsystem\.com", r"adsystem\.amazon\.com",
    
    # Pop/Push networks (high MFA indicator)
    r"propellerads\.com", r"popads\.net", r"exoclick\.com", r"adcash\.com",
    r"popcash\.net", r"adsterra\.com", r"admaven\.com", r"monetag\.com",
]

# Prebid/Header Bidding patterns
PREBID_PATTERNS = [
    r"prebid", r"pbjs", r"/hb/", r"header-bidding",
    r"hb_bidder", r"hb_pb", r"hb_adid",
]

# VAST/Video ad patterns  
VAST_PATTERNS = [
    r"vast", r"/ad/", r"vpaid", r"video/ad",
    r"ima3\.js", r"imasdk", r"googlevideo\.com/videoad",
]

# Traffic arbitrage sources (from JS traffic-arbitrage.js)
ARBITRAGE_SOURCES = [
    r"taboola\.com", r"outbrain\.com", r"revcontent\.com", r"mgid\.com",
    r"content\.ad", r"zergnet\.com", r"postquare\.com",
    r"facebook\.com/tr", r"facebook\.net/tr",  # FB pixel for paid social
    r"tiktok\.com", r"analytics\.tiktok\.com",
    r"onesignal\.com", r"pushcrew\.com", r"pushengage\.com",
]

# Compile patterns
AD_PATTERNS_COMPILED = [re.compile(p, re.IGNORECASE) for p in AD_NETWORK_PATTERNS]
PREBID_PATTERNS_COMPILED = [re.compile(p, re.IGNORECASE) for p in PREBID_PATTERNS]
VAST_PATTERNS_COMPILED = [re.compile(p, re.IGNORECASE) for p in VAST_PATTERNS]
ARBITRAGE_PATTERNS_COMPILED = [re.compile(p, re.IGNORECASE) for p in ARBITRAGE_SOURCES]


class NetworkInterceptor:
    """
    Industry-standard network request analyzer for MFA detection.
    
    Aligned with:
    - IAS MFA detection methodology
    - Pixalate ad fraud scoring
    - IAB Tech Lab standards
    - MRC invalid traffic guidelines
    
    Features:
    - Ad request identification (40+ networks)
    - Prebid/header bidding detection
    - VAST/video ad tracking
    - Auto-refresh pattern detection
    - Traffic arbitrage signal detection
    - Blocked ad tracking
    """
    
    def __init__(self):
        self.requests: list[dict[str, Any]] = []
        self.ad_requests: list[dict[str, Any]] = []
        self.prebid_events: list[dict[str, Any]] = []
        self.vast_calls: list[dict[str, Any]] = []
        self.websockets: list[dict[str, Any]] = []
        self.blocked_requests: list[dict[str, Any]] = []
        self.refresh_patterns: dict[str, list[float]] = {}
    
    def analyze_requests(
        self,
        requests: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """
        Analyze network requests for MFA patterns.
        
        Args:
            requests: List of request objects with url, type, timing
            
        Returns:
            Comprehensive analysis with industry-standard metrics
        """
        self.requests = requests
        self.ad_requests = []
        self.prebid_events = []
        self.vast_calls = []
        
        for req in requests:
            url = req.get("url", "")
            self._categorize_request(url, req)
        
        # Analyze patterns
        refresh_analysis = self._analyze_refresh_patterns()
        network_stats = self._calculate_network_stats()
        suspicious_patterns = self._detect_suspicious_patterns()
        arbitrage_signals = self._detect_arbitrage_signals()
        
        # Calculate risk score (IAS-style 0-100)
        risk_score = self._calculate_network_risk_score(suspicious_patterns)
        
        return {
            # Core metrics
            "total_requests": len(requests),
            "ad_requests_count": len(self.ad_requests),
            "ad_request_percentage": round(
                len(self.ad_requests) / max(len(requests), 1) * 100, 2
            ),
            
            # Header bidding / Prebid
            "prebid_events_count": len(self.prebid_events),
            "has_header_bidding": len(self.prebid_events) > 0,
            
            # Video ads (VAST)
            "vast_calls_count": len(self.vast_calls),
            "has_video_ads": len(self.vast_calls) > 0,
            
            # Networks
            "ad_networks": network_stats["networks"],
            "ad_network_count": len(network_stats["networks"]),
            "network_requests_by_type": network_stats["by_type"],
            
            # Refresh patterns (key MFA indicator per IAS)
            "refresh_patterns": refresh_analysis,
            "has_auto_refresh": refresh_analysis.get("detected", False),
            
            # Traffic arbitrage (Pixalate methodology)
            "arbitrage_signals": arbitrage_signals,
            "has_arbitrage_traffic": arbitrage_signals.get("detected", False),
            
            # Suspicious patterns
            "suspicious_patterns": suspicious_patterns,
            "has_suspicious_activity": len(suspicious_patterns) > 0,
            
            # Risk score (0-100, higher = more risk)
            "network_risk_score": risk_score,
            "risk_level": self._get_risk_level(risk_score),
        }
    
    def _categorize_request(self, url: str, req: dict[str, Any]) -> None:
        """Categorize a request by type."""
        url_lower = url.lower()
        timing = req.get("timing", {}).get("startTime", 0)
        
        # Check for ad network
        if self._matches_patterns(url_lower, AD_PATTERNS_COMPILED):
            network = self._identify_network(url)
            self.ad_requests.append({
                "url": url,
                "network": network,
                "type": req.get("type", "unknown"),
                "timing": timing,
            })
            self._track_refresh_pattern(url, timing)
        
        # Check for Prebid/Header Bidding
        if self._matches_patterns(url_lower, PREBID_PATTERNS_COMPILED):
            self.prebid_events.append({
                "url": url,
                "timestamp": timing,
            })
        
        # Check for VAST/Video ads
        if self._matches_patterns(url_lower, VAST_PATTERNS_COMPILED):
            self.vast_calls.append({
                "url": url,
                "timestamp": timing,
                "type": "VAST",
            })
    
    def _matches_patterns(self, text: str, patterns: list) -> bool:
        """Check if text matches any pattern."""
        return any(p.search(text) for p in patterns)
    
    def _identify_network(self, url: str) -> str:
        """Identify the ad network from URL."""
        url_lower = url.lower()
        
        network_map = {
            "googlesyndication": "Google AdSense",
            "doubleclick": "Google DFP/AdX",
            "googleadservices": "Google Ads",
            "securepubads": "Google Publisher Tags",
            "facebook": "Meta",
            "amazon-adsystem": "Amazon",
            "criteo": "Criteo",
            "taboola": "Taboola",
            "outbrain": "Outbrain",
            "pubmatic": "PubMatic",
            "rubiconproject": "Rubicon",
            "openx": "OpenX",
            "adnxs": "AppNexus/Xandr",
            "adsrvr": "The Trade Desk",
            "moatads": "Moat",
            "adsafeprotected": "IAS",
            "doubleverify": "DoubleVerify",
            "indexexchange": "Index Exchange",
            "triplelift": "TripleLift",
            "33across": "33Across",
            "teads": "Teads",
            "mgid": "MGID",
            "revcontent": "RevContent",
            "propellerads": "PropellerAds",
            "adsterra": "Adsterra",
        }
        
        for pattern, name in network_map.items():
            if pattern in url_lower:
                return name
        
        try:
            parsed = urlparse(url)
            return parsed.netloc.split(".")[-2] if parsed.netloc else "Unknown"
        except Exception:
            return "Unknown"
    
    def _track_refresh_pattern(self, url: str, timing: float) -> None:
        """Track refresh patterns for auto-refresh detection."""
        try:
            parsed = urlparse(url)
            domain = parsed.netloc
            
            if domain not in self.refresh_patterns:
                self.refresh_patterns[domain] = []
            self.refresh_patterns[domain].append(timing)
        except Exception:
            pass
    
    def _analyze_refresh_patterns(self) -> dict[str, Any]:
        """Detect auto-refresh patterns (key IAS MFA indicator)."""
        suspicious_refreshes = []
        
        for domain, timings in self.refresh_patterns.items():
            if len(timings) < 2:
                continue
            
            timings.sort()
            intervals = [
                timings[i+1] - timings[i]
                for i in range(len(timings) - 1)
            ]
            
            if not intervals:
                continue
            
            avg_interval = sum(intervals) / len(intervals)
            min_interval = min(intervals)
            
            # Flag suspicious patterns (per IAS methodology)
            # < 30 seconds = HIGH severity
            # < 60 seconds = MEDIUM severity
            if min_interval < 30000 or avg_interval < 60000:
                severity = "HIGH" if min_interval < 15000 else "MEDIUM"
                suspicious_refreshes.append({
                    "domain": domain,
                    "avg_interval_ms": round(avg_interval),
                    "min_interval_ms": round(min_interval),
                    "request_count": len(timings),
                    "severity": severity,
                })
        
        return {
            "detected": len(suspicious_refreshes) > 0,
            "count": len(suspicious_refreshes),
            "patterns": suspicious_refreshes[:5],
        }
    
    def _calculate_network_stats(self) -> dict[str, Any]:
        """Calculate network statistics."""
        networks: dict[str, int] = {}
        by_type: dict[str, int] = {}
        
        for req in self.ad_requests:
            network = req.get("network", "Unknown")
            req_type = req.get("type", "unknown")
            
            networks[network] = networks.get(network, 0) + 1
            by_type[req_type] = by_type.get(req_type, 0) + 1
        
        return {
            "networks": dict(sorted(networks.items(), key=lambda x: -x[1])[:15]),
            "by_type": by_type,
        }
    
    def _detect_arbitrage_signals(self) -> dict[str, Any]:
        """Detect traffic arbitrage signals (Pixalate methodology)."""
        arbitrage_requests = []
        
        for req in self.requests:
            url = req.get("url", "")
            if self._matches_patterns(url.lower(), ARBITRAGE_PATTERNS_COMPILED):
                source = self._identify_arbitrage_source(url)
                arbitrage_requests.append({
                    "url": url[:100],
                    "source": source,
                })
        
        unique_sources = list(set(r["source"] for r in arbitrage_requests))
        
        return {
            "detected": len(unique_sources) >= 2,
            "source_count": len(unique_sources),
            "sources": unique_sources,
            "is_mfa_indicator": len(unique_sources) >= 2,
        }
    
    def _identify_arbitrage_source(self, url: str) -> str:
        """Identify traffic arbitrage source."""
        url_lower = url.lower()
        sources = {
            "taboola": "Taboola",
            "outbrain": "Outbrain",
            "revcontent": "RevContent",
            "mgid": "MGID",
            "zergnet": "ZergNet",
            "facebook": "Facebook Paid",
            "tiktok": "TikTok Paid",
            "onesignal": "Push Notifications",
        }
        
        for pattern, name in sources.items():
            if pattern in url_lower:
                return name
        return "Unknown"
    
    def _detect_suspicious_patterns(self) -> list[dict[str, Any]]:
        """Detect suspicious patterns (aligned with IAS/Pixalate)."""
        patterns = []
        
        # EXCESSIVE_AD_CALLS (IAS threshold)
        if len(self.ad_requests) > 100:
            patterns.append({
                "type": "EXCESSIVE_AD_CALLS",
                "description": f"Found {len(self.ad_requests)} ad requests (threshold: 100)",
                "severity": "HIGH",
                "count": len(self.ad_requests),
            })
        elif len(self.ad_requests) > 50:
            patterns.append({
                "type": "HIGH_AD_CALLS",
                "description": f"Found {len(self.ad_requests)} ad requests",
                "severity": "MEDIUM",
                "count": len(self.ad_requests),
            })
        
        # MULTIPLE_PREBID_AUCTIONS
        if len(self.prebid_events) > 10:
            patterns.append({
                "type": "MULTIPLE_PREBID_AUCTIONS",
                "description": f"Detected {len(self.prebid_events)} Prebid events",
                "severity": "MEDIUM",
                "count": len(self.prebid_events),
            })
        
        # AUTO_REFRESH_ADS
        refresh = self._analyze_refresh_patterns()
        if refresh["detected"]:
            high_severity = any(p["severity"] == "HIGH" for p in refresh["patterns"])
            patterns.append({
                "type": "AUTO_REFRESH_ADS",
                "description": f"Detected {refresh['count']} auto-refresh patterns",
                "severity": "HIGH" if high_severity else "MEDIUM",
                "networks": [p["domain"] for p in refresh["patterns"]],
            })
        
        # FRAGMENTED_AD_STACK (many networks = arbitrage indicator)
        unique_networks = set(r["network"] for r in self.ad_requests)
        if len(unique_networks) > 15:
            patterns.append({
                "type": "FRAGMENTED_AD_STACK",
                "description": f"Using {len(unique_networks)} different ad networks",
                "severity": "MEDIUM",
                "count": len(unique_networks),
            })
        
        # EXCESSIVE_VIDEO_ADS
        if len(self.vast_calls) > 5:
            patterns.append({
                "type": "EXCESSIVE_VIDEO_ADS",
                "description": f"Found {len(self.vast_calls)} video ad calls",
                "severity": "MEDIUM",
                "count": len(self.vast_calls),
            })
        
        return patterns
    
    def _calculate_network_risk_score(
        self,
        patterns: list[dict[str, Any]],
    ) -> int:
        """Calculate network risk score (0-100, IAS-style)."""
        score = 0
        
        # Base score from ad request count (aggressive like JS worker)
        if len(self.ad_requests) > 100:
            score += 70
        elif len(self.ad_requests) > 50:
            score += 40
        elif len(self.ad_requests) > 25:
            score += 15
        
        # Pattern contributions
        for pattern in patterns:
            pattern_type = pattern.get("type", "")
            severity = pattern.get("severity", "LOW")
            
            if pattern_type == "AUTO_REFRESH_ADS":
                score += 40 if severity == "HIGH" else 25
            elif pattern_type == "EXCESSIVE_AD_CALLS":
                score += 30 if severity == "HIGH" else 15
            elif pattern_type == "MULTIPLE_PREBID_AUCTIONS":
                score += 10
            elif pattern_type == "EXCESSIVE_VIDEO_ADS":
                score += 15
            elif pattern_type == "FRAGMENTED_AD_STACK":
                score += 5
        
        return min(100, score)
    
    def _get_risk_level(self, score: int) -> str:
        """Map score to risk level."""
        if score >= 70:
            return "high"
        elif score >= 40:
            return "medium"
        else:
            return "low"
