"""
CrawlSignalSchema - Single source of truth for all analyzer inputs.

This schema defines the contract between the crawler and all analyzers.
If a signal is not here, it does not exist.
"""

from typing import Any
from pydantic import BaseModel, Field


class ContentSignals(BaseModel):
    """Signals related to page content quality."""
    word_count: int = 0
    text_length: int = 0
    unique_word_ratio: float = 0.0
    readability_score: float = 0.0
    topic: str = ""
    is_high_ecpm_topic: bool = False
    language: str = "en"
    freshness_days: int | None = None


class AdSignals(BaseModel):
    """Signals related to advertising on the page."""
    total_ads: int = 0
    ads_above_fold: int = 0
    sticky_ads: int = 0
    hidden_ads: int = 0
    ad_density: float = 0.0
    auto_refresh_detected: bool = False
    refresh_interval_ms: int | None = None
    ad_networks: list[str] = Field(default_factory=list)


class VideoSignals(BaseModel):
    """Signals related to video content (MFA indicator)."""
    total_videos: int = 0
    autoplay_count: int = 0
    muted_autoplay_count: int = 0
    sticky_videos: int = 0
    hidden_videos: int = 0
    video_stuffing: bool = False


class PopupSignals(BaseModel):
    """Signals related to popups and interstitials."""
    total_popups: int = 0
    interstitial_count: int = 0
    has_newsletter_popup: bool = False


class LayoutSignals(BaseModel):
    """Signals related to page layout and structure."""
    viewport_height: int = 0
    document_height: int = 0
    content_to_ad_ratio: float = 0.0
    has_infinite_scroll: bool = False
    has_main_nav: bool = False
    has_footer: bool = False
    has_sidebar: bool = False
    internal_link_count: int = 0


class NetworkSignals(BaseModel):
    """Signals from network request analysis."""
    total_requests: int = 0
    ad_request_count: int = 0
    ad_to_content_ratio: float = 0.0
    prebid_detected: bool = False
    vast_detected: bool = False
    refresh_detected: bool = False
    detected_networks: list[str] = Field(default_factory=list)


class PolicySignals(BaseModel):
    """Signals related to policy compliance."""
    has_privacy_policy: bool = False
    has_terms: bool = False
    has_contact: bool = False
    has_about: bool = False
    has_cookie_consent: bool = False
    policy_contents: dict[str, str] = Field(default_factory=dict)


class BehaviorSignals(BaseModel):
    """Signals related to page behavior."""
    redirect_count: int = 0
    forced_pagination: bool = False
    scroll_trap: bool = False


class CrawlMeta(BaseModel):
    """Metadata about the crawl operation."""
    crawl_time_ms: float = 0
    js_enabled: bool = True
    screenshot_captured: bool = False
    errors: list[str] = Field(default_factory=list)


class CrawlSignals(BaseModel):
    """
    Single source of truth for all analyzer inputs.
    
    All analyzers MUST accept this schema.
    If a signal is not defined here, it does not exist.
    """
    # URL decomposition
    url: str
    domain: str = ""
    subdomain: str | None = None
    path: str = ""
    
    # Raw content (for deep analysis)
    html: str = ""
    text: str = ""
    title: str = ""
    screenshot_base64: str | None = None
    
    # Structured signals
    content: ContentSignals = Field(default_factory=ContentSignals)
    ads: AdSignals = Field(default_factory=AdSignals)
    videos: VideoSignals = Field(default_factory=VideoSignals)
    popups: PopupSignals = Field(default_factory=PopupSignals)
    layout: LayoutSignals = Field(default_factory=LayoutSignals)
    network: NetworkSignals = Field(default_factory=NetworkSignals)
    policy: PolicySignals = Field(default_factory=PolicySignals)
    behavior: BehaviorSignals = Field(default_factory=BehaviorSignals)
    meta: CrawlMeta = Field(default_factory=CrawlMeta)
    
    @classmethod
    def from_crawl_result(cls, crawl_result: Any) -> "CrawlSignals":
        """Convert CrawlResult to CrawlSignals."""
        from urllib.parse import urlparse
        
        parsed = urlparse(crawl_result.url)
        domain_parts = parsed.netloc.split(".")
        subdomain = ".".join(domain_parts[:-2]) if len(domain_parts) > 2 else None
        
        stats = crawl_result.stats or {}
        nav = crawl_result.navigation or {}
        layout_data = crawl_result.layout or {}
        policy_data = crawl_result.policy_pages or {}
        
        return cls(
            url=crawl_result.url,
            domain=parsed.netloc,
            subdomain=subdomain,
            path=parsed.path,
            html=crawl_result.html,
            text=crawl_result.text,
            title=crawl_result.title,
            screenshot_base64=crawl_result.screenshot_base64,
            content=ContentSignals(
                word_count=len(crawl_result.text.split()) if crawl_result.text else 0,
                text_length=len(crawl_result.text or ""),
            ),
            ads=AdSignals(
                total_ads=stats.get("totalAds", 0),
                ads_above_fold=stats.get("adsAboveFold", 0),
                sticky_ads=stats.get("stickyAds", 0),
            ),
            videos=VideoSignals(
                total_videos=stats.get("totalVideos", 0),
                autoplay_count=stats.get("autoplaying", 0),
                muted_autoplay_count=stats.get("mutedAutoplay", 0),
            ),
            popups=PopupSignals(
                total_popups=stats.get("totalPopups", 0),
                interstitial_count=stats.get("interstitials", 0),
            ),
            layout=LayoutSignals(
                viewport_height=layout_data.get("viewportHeight", 0),
                document_height=layout_data.get("documentHeight", 0),
                has_infinite_scroll=layout_data.get("hasInfiniteScroll", False),
                has_main_nav=nav.get("hasMainNav", False),
                has_footer=nav.get("hasFooter", False),
                has_sidebar=nav.get("hasSidebar", False),
                internal_link_count=nav.get("internalLinkCount", 0),
            ),
            network=NetworkSignals(
                total_requests=crawl_result.total_requests,
                ad_request_count=len(crawl_result.ad_requests or []),
            ),
            policy=PolicySignals(
                has_privacy_policy=policy_data.get("privacy", False),
                has_terms=policy_data.get("terms", False),
                has_contact=policy_data.get("contact", False),
                has_about=policy_data.get("about", False),
                has_cookie_consent=policy_data.get("cookie", False),
                policy_contents=getattr(crawl_result, "policy_contents", {})
            ),
            meta=CrawlMeta(
                crawl_time_ms=crawl_result.load_time_ms,
                screenshot_captured=crawl_result.screenshot_base64 is not None,
                errors=[crawl_result.error] if crawl_result.error else [],
            ),
        )


# High eCPM topics (MFA indicator when combined with thin content)
HIGH_ECPM_TOPICS = [
    "health", "insurance", "loan", "mortgage", "legal", "lawyer",
    "finance", "crypto", "bitcoin", "forex", "trading", "investment",
    "education", "degree", "certification", "online course",
    "weight loss", "diet", "supplement", "medication",
]

# MFA directory path patterns
MFA_PATH_PATTERNS = [
    "/health/", "/education/", "/insurance/", "/loan/", "/legal/",
    "/crypto/", "/news/", "/amp/", "/tag/", "/category/",
    "/page/", "/topic/", "/article/", "/post/",
]
