"""
AuditCrawler - crawl4ai-based site crawler for MFA detection.
Wraps crawl4ai's AsyncWebCrawler with MFA-specific configuration.
"""

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from src.config import settings
from src.utils.logger import get_logger

logger = get_logger(__name__)


class CrawlResult(BaseModel):
    """Result of a site crawl - single source of truth for all analyzers."""
    url: str
    html: str = ""
    markdown: str = ""
    text: str = ""
    title: str = ""
    
    # Network data
    requests: list[dict[str, Any]] = []
    ad_requests: list[dict[str, Any]] = []
    
    # Page metrics
    load_time_ms: float = 0
    total_requests: int = 0
    
    # Screenshots (base64)
    screenshot_base64: str | None = None
    
    # Extracted elements
    links: list[dict[str, str]] = []
    images: list[dict[str, str]] = []
    iframes: list[dict[str, str]] = []
    scripts: list[str] = []
    
    # Ad-related elements
    ad_elements: list[dict[str, Any]] = []
    stacked_ads: list[dict[str, Any]] = []
    
    # Video elements (for MFA detection - stuffing, autoplay, sticky)
    video_elements: list[dict[str, Any]] = []
    
    # Native widgets (Taboola, Outbrain, etc.)
    native_widgets: list[dict[str, Any]] = []
    
    # Popup/modal/interstitial elements
    popup_elements: list[dict[str, Any]] = []
    
    # Policy page detection
    policy_pages: dict[str, bool] = {
        "privacy": False,
        "terms": False,
        "contact": False,
        "about": False,
        "cookie": False
    }
    
    # Page classification
    page_type: str = "general"  # "privacy", "terms", "about", "contact", "general"
    
    # Navigation structure
    navigation: dict[str, Any] = {
        "hasMainNav": False,
        "menuItemCount": 0,
        "hasFooter": False,
        "hasSidebar": False,
        "internalLinkCount": 0
    }
    
    # Layout metrics
    layout: dict[str, Any] = {
        "viewportHeight": 0,
        "documentHeight": 0,
        "hasInfiniteScroll": False,
        "contentToAdRatio": 0
    }
    
    # Aggregate stats (pre-calculated in JS for efficiency)
    stats: dict[str, int] = {
        "totalAds": 0,
        "adsAboveFold": 0,
        "stickyAds": 0,
        "totalPopups": 0,
        "interstitials": 0,
        "totalVideos": 0,
        "autoplaying": 0,
        "mutedAutoplay": 0
    }
    
    # Crawl status: SUCCESS, BLOCKED, FALLBACK, FAILED
    crawl_status: str = "SUCCESS"
    # Crawl method: crawl4ai, cloudscraper, gam_only
    crawl_method: str = "crawl4ai"
    
    # Errors
    error: str | None = None


# Known ad network domains for detection
AD_NETWORK_DOMAINS = [
    "googlesyndication.com",
    "googleadservices.com",
    "doubleclick.net",
    "googleads.g.doubleclick.net",
    "adnxs.com",
    "adsrvr.org",
    "criteo.com",
    "facebook.net/*/pixel",
    "amazon-adsystem.com",
    "taboola.com",
    "outbrain.com",
    "mgid.com",
    "pubmatic.com",
    "rubiconproject.com",
    "openx.net",
    "casalemedia.com",
    "bidswitch.net",
    "smartadserver.com",
    "teads.tv",
    "adsafeprotected.com",
    "moatads.com",
]

# Selectors for ad elements
AD_SELECTORS = [
    '[id*="google_ads"]',
    '[id*="ad-"]',
    '[id*="-ad"]',
    '[class*="ad-container"]',
    '[class*="adsbygoogle"]',
    '[data-ad-slot]',
    '[data-ad-client]',
    'ins.adsbygoogle',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="doubleclick"]',
    'div[aria-label*="advertisement"]',
]


class AuditCrawler:
    """
    Crawl4AI-based crawler optimized for MFA site auditing.
    
    Features:
    - Anti-bot stealth mode
    - Network request interception
    - Ad element detection
    - Screenshot capture
    - LLM-friendly output
    """
    
    def __init__(self):
        self._crawler = None
        self._captured_requests: list[dict[str, Any]] = []
    
    async def crawl(self, url: str) -> CrawlResult:
        """
        Crawl a URL and extract all relevant data for MFA analysis.
        """
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig
        
        logger.info("Starting crawl", url=url)
        
        try:
            # Configure browser
            browser_config = BrowserConfig(
                headless=settings.crawler_headless,
                verbose=False,
                extra_args=[
                    "--disable-blink-features=AutomationControlled",
                    "--disable-infobars",
                ],
            )
            
            # Configure crawl run with enhanced JS for comprehensive MFA detection
            js_code = """
            (() => {
                const viewportHeight = window.innerHeight;
                const scrollY = window.scrollY || 0;
                
                // ============== AD DETECTION ==============
                const ads = [];
                const adSelectors = [
                    '[id*="google_ads"]', '[id*="ad-"]', '[id*="-ad"]',
                    '[class*="ad-container"]', '[class*="adsbygoogle"]',
                    '[data-ad-slot]', '[data-ad-client]', 'ins.adsbygoogle',
                    'iframe[src*="googlesyndication"]', 'iframe[src*="doubleclick"]',
                    'div[aria-label*="advertisement"]', '[id*="dfp"]',
                    '[class*="ad-slot"]', '[class*="ad_slot"]'
                ];
                
                adSelectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(el => {
                        const rect = el.getBoundingClientRect();
                        const style = window.getComputedStyle(el);
                        const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0.1;
                        const isHidden = !isVisible || rect.width < 2 || rect.height < 2;
                        
                        if (rect.width > 0 && rect.height > 0) {
                            ads.push({
                                selector: selector,
                                tag: el.tagName,
                                x: rect.left,
                                y: rect.top + scrollY,
                                width: rect.width,
                                height: rect.height,
                                visible: isVisible,
                                isHidden: isHidden,
                                isAboveFold: (rect.top + scrollY) < viewportHeight,
                                isSticky: style.position === 'fixed' || style.position === 'sticky',
                                inViewport: rect.top < viewportHeight && rect.left < window.innerWidth,
                                zIndex: parseInt(style.zIndex) || 0,
                                opacity: parseFloat(style.opacity) || 1
                            });
                        }
                    });
                });

                // ============== AD STACKING DETECTION ==============
                const stackedAds = [];
                for (let i = 0; i < ads.length; i++) {
                    for (let j = i + 1; j < ads.length; j++) {
                        const a = ads[i];
                        const b = ads[j];
                        
                        // Check for significant overlap
                        const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
                        const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
                        const overlapArea = overlapX * overlapY;
                        
                        if (overlapArea > 0) {
                            const areaA = a.width * a.height;
                            const areaB = b.width * b.height;
                            const overlapPctA = overlapArea / areaA;
                            const overlapPctB = overlapArea / areaB;
                            
                            if (overlapPctA > 0.5 || overlapPctB > 0.5) {
                                stackedAds.push({
                                    adA: i,
                                    adB: j,
                                    overlapPct: Math.max(overlapPctA, overlapPctB)
                                });
                            }
                        }
                    }
                }
                
                // ============== POPUP/MODAL DETECTION ==============
                const popups = [];
                const popupSelectors = [
                    '[class*="popup"]', '[class*="modal"]', '[class*="overlay"]',
                    '[id*="popup"]', '[id*="modal"]', '[role="dialog"]',
                    '[class*="interstitial"]', '[class*="lightbox"]',
                    '[class*="newsletter"]', '[class*="subscribe"]'
                ];
                
                popupSelectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(el => {
                        const rect = el.getBoundingClientRect();
                        const style = window.getComputedStyle(el);
                        const isVisible = style.display !== 'none' && style.visibility !== 'hidden';
                        const isFullScreen = rect.width > window.innerWidth * 0.8 && rect.height > viewportHeight * 0.8;
                        if (isVisible) {
                            popups.push({
                                selector: selector,
                                isFullScreen: isFullScreen,
                                isInterstitial: isFullScreen && style.position === 'fixed',
                                hasCloseButton: !!el.querySelector('[class*="close"], [aria-label="close"], button'),
                                zIndex: parseInt(style.zIndex) || 0
                            });
                        }
                    });
                });
                
                // ============== VIDEO DETECTION ==============
                const videos = [];
                document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="dailymotion"]').forEach(el => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    videos.push({
                        tag: el.tagName,
                        src: el.src || el.getAttribute('src') || '',
                        autoplay: el.autoplay || el.hasAttribute('autoplay'),
                        muted: el.muted || el.hasAttribute('muted'),
                        loop: el.loop || el.hasAttribute('loop'),
                        width: rect.width,
                        height: rect.height,
                        isHidden: rect.width < 10 || rect.height < 10 || style.display === 'none' || style.opacity === '0',
                        isSticky: style.position === 'fixed' || style.position === 'sticky',
                        inViewport: rect.top < viewportHeight && rect.bottom > 0,
                        zIndex: parseInt(style.zIndex) || 0
                    });
                });
                
                // ============== NATIVE WIDGET DETECTION ==============
                const widgets = [];
                const widgetSelectors = [
                    '[id*="taboola"]', '[class*="taboola"]',
                    '[id*="outbrain"]', '[class*="outbrain"]', '.OUTBRAIN',
                    '[id*="mgid"]', '[class*="mgid"]',
                    '[id*="revcontent"]', '[class*="revcontent"]',
                    '[id*="zergnet"]', '[class*="content-recommendation"]'
                ];
                widgetSelectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(el => {
                        widgets.push({
                            selector: selector,
                            type: selector.includes('taboola') ? 'taboola' : 
                                  selector.includes('outbrain') ? 'outbrain' :
                                  selector.includes('mgid') ? 'mgid' :
                                  selector.includes('revcontent') ? 'revcontent' : 'other'
                        });
                    });
                });
                
                // ============== POLICY PAGE LINKS ==============
                const policyPages = {
                    privacy: false,
                    terms: false,
                    contact: false,
                    about: false,
                    cookie: false
                };
                document.querySelectorAll('a[href]').forEach(a => {
                    const href = a.href.toLowerCase();
                    if (href.includes('privacy') || href.includes('datenschutz')) policyPages.privacy = true;
                    if (href.includes('terms') || href.includes('tos') || href.includes('conditions')) policyPages.terms = true;
                    if (href.includes('contact') || href.includes('kontakt')) policyPages.contact = true;
                    if (href.includes('about') || href.includes('ueber-uns')) policyPages.about = true;
                    if (href.includes('cookie')) policyPages.cookie = true;
                });
                
                // ============== NAVIGATION STRUCTURE ==============
                const navigation = {
                    hasMainNav: !!document.querySelector('nav, [role="navigation"]'),
                    menuItemCount: document.querySelectorAll('nav a, [role="navigation"] a').length,
                    hasFooter: !!document.querySelector('footer'),
                    hasSidebar: !!document.querySelector('aside, [class*="sidebar"]'),
                    internalLinkCount: document.querySelectorAll('a[href^="/"], a[href^="' + window.location.origin + '"]').length
                };
                
                // ============== LAYOUT METRICS ==============
                const layout = {
                    viewportHeight: viewportHeight,
                    documentHeight: document.documentElement.scrollHeight,
                    hasInfiniteScroll: !!document.querySelector('[data-infinite], [class*="infinite"]'),
                    contentToAdRatio: 0  // Will be calculated server-side
                };
                
                // ============== AGGREGATE STATS ==============
                const stats = {
                    totalAds: ads.length,
                    adsAboveFold: ads.filter(a => a.isAboveFold).length,
                    stickyAds: ads.filter(a => a.isSticky).length,
                    hiddenAds: ads.filter(a => a.isHidden).length,
                    stackedAdsCount: stackedAds.length,
                    totalPopups: popups.length,
                    interstitials: popups.filter(p => p.isInterstitial).length,
                    totalVideos: videos.length,
                    autoplaying: videos.filter(v => v.autoplay).length,
                    mutedAutoplay: videos.filter(v => v.autoplay && v.muted).length
                };
                
                return JSON.stringify({ 
                    ads: ads, 
                    stackedAds: stackedAds,
                    videos: videos, 
                    widgets: widgets,
                    popups: popups,
                    policyPages: policyPages,
                    navigation: navigation,
                    layout: layout,
                    stats: stats
                });
            })()
            """

            
            run_config = CrawlerRunConfig(
                wait_until="networkidle",
                page_timeout=settings.crawler_timeout_ms,
                screenshot=True,
                process_iframes=True,
                remove_overlay_elements=True,
                capture_network_requests=True,  # CRITICAL: Enable network request capture
                js_code=js_code,
            )
            
            async with AsyncWebCrawler(config=browser_config) as crawler:
                result = await crawler.arun(
                    url=url,
                    config=run_config,
                )
                
                if not result.success:
                    logger.warning("Crawl failed", url=url, error=result.error_message)
                    # Check for blocking even in failed result
                    is_blocked = any(x in str(result.error_message).lower() for x in ["403", "429", "cloudflare", "captcha", "challenge", "blocked", "forbidden", "access denied"])
                    if is_blocked:
                        return await self._crawl_with_cloudscraper(url)
                    return CrawlResult(url=url, error=result.error_message, crawl_status="FAILED")
                
                # Check for silent blocks (200 OK but challenge page)
                if result.html and len(result.html) < 2000:
                    html_lower = result.html.lower()
                    if any(x in html_lower for x in ["cloudflare", "captcha", "challenge", "access denied", "blocked"]):
                        logger.warning("Silent block detected (Cloudflare/CAPTCHA)", url=url)
                        return await self._crawl_with_cloudscraper(url)
                
                logger.info("Crawl result", url=url, html_len=len(result.html), text_len=len(result.text))
                
                # Parse JS extraction result (returns JSON with ads, videos, widgets, popups, etc.)
                ad_elements = []
                stacked_ads = []
                video_elements = []
                native_widgets = []
                popup_elements = []
                policy_pages = {}
                navigation = {}
                layout = {}
                stats = {}
                
                if hasattr(result, "extracted_content") and result.extracted_content:
                    try:
                        import json
                        js_result = result.extracted_content
                        # Handle if it's a string (JSON) or already parsed
                        if isinstance(js_result, str):
                            parsed = json.loads(js_result)
                        else:
                            parsed = js_result
                        
                        if isinstance(parsed, dict):
                            ad_elements = parsed.get("ads", [])
                            stacked_ads = parsed.get("stackedAds", [])
                            video_elements = parsed.get("videos", [])
                            native_widgets = parsed.get("widgets", [])
                            popup_elements = parsed.get("popups", [])
                            policy_pages = parsed.get("policyPages", {})
                            navigation = parsed.get("navigation", {})
                            layout = parsed.get("layout", {})
                            stats = parsed.get("stats", {})
                    except (json.JSONDecodeError, TypeError) as e:
                        logger.warning("Failed to parse JS result", error=str(e))
                        # Fallback: JS might have returned simple array
                        if isinstance(result.extracted_content, list):
                            ad_elements = result.extracted_content
                
                # Fallback: Extract ad elements from HTML if JS didn't find any
                if not ad_elements:
                    ad_elements = self._extract_ad_elements(result.html)
                
                # Get network requests from crawl4ai (CRITICAL FIX: use network_requests, not links)
                network_requests = []
                if hasattr(result, "network_requests") and result.network_requests:
                    network_requests = result.network_requests
                
                # Identify ad-related requests from network traffic
                ad_requests = self._identify_ad_requests(network_requests)
                
                # Extract plain text from HTML (not cleaned_html which is still HTML)
                plain_text = self._extract_plain_text(result.html or "")
                
                # Extract load time from response if available
                load_time_ms = 0
                if hasattr(result, "response_headers") and result.response_headers:
                    # Try to get timing from headers
                    load_time_ms = float(result.response_headers.get("x-response-time", 0))
                
                logger.info(
                    "Crawl complete",
                    url=url,
                    ad_elements=len(ad_elements),
                    video_elements=len(video_elements),
                    network_requests=len(network_requests),
                    ad_requests=len(ad_requests),
                )
                
                return CrawlResult(
                    url=url,
                    html=result.html or "",
                    markdown=result.markdown or "",
                    text=plain_text,
                    title=result.metadata.get("title", "") if result.metadata else "",
                    screenshot_base64=result.screenshot if result.screenshot else None,
                    links=self._extract_links(result),
                    images=self._extract_images(result),
                    iframes=self._extract_iframes(result.html or ""),
                    scripts=self._extract_scripts(result.html or ""),
                    ad_elements=ad_elements,
                    stacked_ads=stacked_ads,
                    video_elements=video_elements,
                    native_widgets=native_widgets,
                    popup_elements=popup_elements,
                    policy_pages=policy_pages or {},
                    navigation=navigation or {},
                    layout=layout or {},
                    stats=stats or {},
                    ad_requests=ad_requests,
                    requests=network_requests,
                    total_requests=len(network_requests),
                    load_time_ms=load_time_ms,
                    crawl_status="SUCCESS",
                    crawl_method="crawl4ai",
                )
                
        except Exception as e:
            error_str = str(e).lower()
            # Detect if we were blocked (403, 429, Cloudflare, etc.)
            is_blocked = any(x in error_str for x in ["403", "429", "cloudflare", "captcha", "challenge", "blocked", "forbidden", "access denied"])
            
            if is_blocked:
                logger.warning("Crawl blocked, attempting cloudscraper fallback", url=url)
                return await self._crawl_with_cloudscraper(url)
            
            logger.error("Crawl error", url=url, error=str(e))
            return CrawlResult(url=url, error=str(e), crawl_status="FAILED", crawl_method="crawl4ai")
    
    async def _crawl_with_cloudscraper(self, url: str) -> CrawlResult:
        """
        Fallback crawler using cloudscraper to bypass Cloudflare.
        This is a lightweight alternative that doesn't require a full browser.
        """
        try:
            import cloudscraper
            from bs4 import BeautifulSoup
            import asyncio
            
            logger.info("Using cloudscraper fallback", url=url)
            
            # Create scraper with browser emulation
            scraper = cloudscraper.create_scraper(
                browser={
                    "browser": "chrome",
                    "platform": "windows",
                    "mobile": False
                }
            )
            
            # Run synchronous cloudscraper in thread pool to avoid blocking
            response = await asyncio.to_thread(scraper.get, url, timeout=30)
            
            if response.status_code in [403, 429, 503]:
                logger.warning("Cloudscraper also blocked", url=url, status=response.status_code)
                return CrawlResult(
                    url=url,
                    error=f"BLOCKED: Site returned {response.status_code}",
                    crawl_status="BLOCKED",
                    crawl_method="cloudscraper",
                )
            
            html = response.text
            
            # Extract basic data from HTML
            soup = BeautifulSoup(html, "lxml")
            title = soup.title.string if soup.title else ""
            plain_text = self._extract_plain_text(html)
            ad_elements = self._extract_ad_elements(html)
            iframes = self._extract_iframes(html)
            scripts = self._extract_scripts(html)
            
            logger.info(
                "Cloudscraper fallback succeeded",
                url=url,
                text_length=len(plain_text),
                ad_elements=len(ad_elements),
            )
            
            return CrawlResult(
                url=url,
                html=html,
                text=plain_text,
                title=title or "",
                iframes=iframes,
                scripts=scripts,
                ad_elements=ad_elements,
                crawl_status="FALLBACK",
                crawl_method="cloudscraper",
            )
            
        except ImportError:
            logger.warning("cloudscraper not installed, returning blocked result")
            return CrawlResult(
                url=url,
                error="BLOCKED: cloudscraper not available",
                crawl_status="BLOCKED",
                crawl_method="none",
            )
        except Exception as e:
            logger.error("Cloudscraper fallback failed", url=url, error=str(e))
            return CrawlResult(
                url=url,
                error=f"BLOCKED: All crawl methods failed - {str(e)}",
                crawl_status="BLOCKED",
                crawl_method="cloudscraper",
            )

    
    def _extract_plain_text(self, html: str) -> str:
        """Extract plain text from HTML, removing scripts, styles, and navigation."""
        from bs4 import BeautifulSoup
        
        if not html:
            return ""
        
        soup = BeautifulSoup(html, "lxml")
        
        # Remove non-content elements
        for element in soup(["script", "style", "nav", "footer", "header", "aside", "noscript", "meta", "link"]):
            element.decompose()
        
        # Get text with proper spacing
        text = soup.get_text(separator=" ", strip=True)
        
        # Clean up excessive whitespace
        import re
        text = re.sub(r'\s+', ' ', text)
        
        return text.strip()
    
    def _extract_ad_elements(self, html: str) -> list[dict[str, Any]]:
        """Extract ad-related elements from HTML."""
        from bs4 import BeautifulSoup
        
        if not html:
            return []
        
        soup = BeautifulSoup(html, "lxml")
        elements = []
        
        for selector in AD_SELECTORS:
            try:
                # Use CSS select
                for el in soup.select(selector):
                    elements.append({
                        "selector": selector,
                        "tag": el.name,
                        "id": el.get("id", ""),
                        "class": " ".join(el.get("class", [])),
                        "src": el.get("src", ""),
                        "data_ad_slot": el.get("data-ad-slot", ""),
                    })
            except Exception:
                continue
        
        return elements
    
    def _identify_ad_requests(self, requests: list[Any]) -> list[dict[str, Any]]:
        """Identify ad-related network requests."""
        ad_requests = []
        
        for req in requests:
            url = req.get("url", "") if isinstance(req, dict) else str(req)
            
            for domain in AD_NETWORK_DOMAINS:
                if domain in url.lower():
                    ad_requests.append({
                        "url": url,
                        "ad_network": domain,
                        "type": req.get("type", "unknown") if isinstance(req, dict) else "unknown",
                    })
                    break
        
        return ad_requests
    
    def _extract_links(self, result: Any) -> list[dict[str, str]]:
        """Extract internal and external links."""
        links = []
        if hasattr(result, "links") and result.links:
            for link in result.links.get("internal", []):
                links.append({"href": link, "type": "internal"})
            for link in result.links.get("external", []):
                links.append({"href": link, "type": "external"})
        return links
    
    def _extract_images(self, result: Any) -> list[dict[str, str]]:
        """Extract image sources."""
        images = []
        if hasattr(result, "media") and result.media:
            for img in result.media.get("images", []):
                images.append({
                    "src": img.get("src", ""),
                    "alt": img.get("alt", ""),
                })
        return images
    
    def _extract_iframes(self, html: str) -> list[dict[str, str]]:
        """Extract iframe sources."""
        from bs4 import BeautifulSoup
        
        if not html:
            return []
        
        soup = BeautifulSoup(html, "lxml")
        iframes = []
        
        for iframe in soup.find_all("iframe"):
            iframes.append({
                "src": iframe.get("src", ""),
                "id": iframe.get("id", ""),
                "class": " ".join(iframe.get("class", [])),
            })
        
        return iframes
    
    def _extract_scripts(self, html: str) -> list[str]:
        """Extract external script sources."""
        from bs4 import BeautifulSoup
        
        if not html:
            return []
        
        soup = BeautifulSoup(html, "lxml")
        scripts = []
        
        for script in soup.find_all("script"):
            src = script.get("src")
            if src:
                scripts.append(src)
        
        return scripts
    
    async def crawl_multi(
        self,
        url: str,
        max_urls: int = 25,
        include_mfa_paths: bool = True,
        force_policy_pages: bool = True,
    ) -> list[CrawlResult]:
        """
        Crawl multiple URLs from a site for comprehensive MFA analysis.
        
        Args:
            url: Starting URL (homepage)
            max_urls: Maximum number of URLs to crawl (including homepage)
            include_mfa_paths: Prioritize MFA-indicator paths (/health/, /amp/, etc.)
            force_policy_pages: Always attempt to crawl /privacy, /terms, /about, /contact
            
        Returns:
            List of CrawlResult objects for each crawled URL
        """
        from urllib.parse import urljoin, urlparse
        
        logger.info("Starting multi-URL crawl", url=url, max_urls=max_urls, force_policy=force_policy_pages)
        
        # First crawl the main URL
        main_result = await self.crawl(url)
        results = [main_result]
        crawled_urls = {url.rstrip("/")}
        
        if main_result.error or max_urls <= 1:
            return results
        
        parsed_base = urlparse(url)
        base_domain = f"{parsed_base.scheme}://{parsed_base.netloc}"
        
        # Parse robots.txt
        rp = await self._parse_robots_txt(base_domain)
        if rp:
            logger.info("Robots.txt parsed", disallowed_count=len(getattr(rp, "disallow_list", [])))
        
        # Force-crawl critical policy pages first (if enabled)
        if force_policy_pages:
            critical_pages = [
                "/privacy", "/privacy-policy",
                "/terms", "/terms-of-service",
                "/about", "/about-us",
                "/contact",
            ]
            for page_path in critical_pages:
                if len(results) >= max_urls:
                    break
                page_url = f"{base_domain}{page_path}"
                if page_url.rstrip("/") not in crawled_urls:
                    try:
                        result = await self.crawl(page_url)
                        # Only add if page exists (no 404)
                        if not result.error or "404" not in str(result.error):
                            # Identify page type
                            if "privacy" in page_path:
                                result.page_type = "privacy"
                            elif "terms" in page_path:
                                result.page_type = "terms"
                            elif "about" in page_path:
                                result.page_type = "about"
                            elif "contact" in page_path:
                                result.page_type = "contact"
                            
                            results.append(result)
                            crawled_urls.add(page_url.rstrip("/"))
                            logger.info("Crawled policy page", page=page_path, success=not result.error)
                    except Exception as e:
                        logger.debug("Policy page not found", page=page_path, error=str(e))
        
        # Try to parse sitemap.xml for more URLs
        sitemap_urls = await self._parse_sitemap(base_domain)
        if sitemap_urls:
            logger.info("Found URLs from sitemap", count=len(sitemap_urls))
        
        # Extract internal links from homepage
        internal_links = self._extract_internal_urls(main_result, url)
        logger.info("Extracted internal links", count=len(internal_links))
        
        # Combine sitemap URLs with internal links (sitemap first)
        all_urls = sitemap_urls + [u for u in internal_links if u not in sitemap_urls]
        
        # Prioritize MFA-indicator paths
        if include_mfa_paths:
            priority_links = self._prioritize_mfa_paths(all_urls)
        else:
            priority_links = all_urls
        
        # Crawl additional URLs (respecting max_urls)
        for next_url in priority_links:
            if len(results) >= max_urls:
                break
            
            if next_url.rstrip("/") not in crawled_urls:
                # Check robots.txt
                if rp and not rp.can_fetch("*", next_url):
                    logger.debug("Skipping URL disallowed by robots.txt", url=next_url)
                    continue
                    
                try:
                    result = await self.crawl(next_url)
                    if not result.error:
                        results.append(result)
                        crawled_urls.add(next_url.rstrip("/"))
                except Exception as e:
                    logger.debug("Failed to crawl additional URL", url=next_url, error=str(e))
        
        logger.info(
            "Multi-URL crawl complete",
            total_urls=len(results),
            successful=len([r for r in results if not r.error]),
        )
        
        return results
    
    async def _parse_sitemap(self, base_domain: str) -> list[str]:
        """Parse sitemap.xml to discover URLs."""
        import httpx
        from xml.etree import ElementTree
        
        urls = []
        sitemap_url = f"{base_domain}/sitemap.xml"
        
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                response = await client.get(sitemap_url)
                if response.status_code != 200:
                    return []
                
                # Parse XML
                root = ElementTree.fromstring(response.content)
                
                # Handle both regular sitemaps and sitemap indexes
                ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
                
                # Try to find <loc> elements
                for loc in root.findall(".//sm:loc", ns):
                    if loc.text:
                        urls.append(loc.text)
                
                # Also try without namespace (some sitemaps don't use it)
                if not urls:
                    for loc in root.findall(".//loc"):
                        if loc.text:
                            urls.append(loc.text)
                
                logger.info("Parsed sitemap", url_count=len(urls))
                
        except Exception as e:
            logger.debug("Sitemap parsing failed", error=str(e))
        
        return urls[:50]  # Limit to 50 URLs from sitemap
    
    async def _parse_robots_txt(self, base_url: str) -> Any:
        """Fetch and parse robots.txt for the site."""
        from urllib.robotparser import RobotFileParser
        import httpx
        
        robots_url = f"{base_url.rstrip('/')}/robots.txt"
        rp = RobotFileParser()
        
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(robots_url)
                if response.status_code == 200:
                    rp.parse(response.text.splitlines())
                    return rp
        except Exception as e:
            logger.debug("Failed to fetch robots.txt", error=str(e))
            
        return None
    
    def _extract_internal_urls(self, crawl_result: CrawlResult, base_url: str) -> list[str]:
        """Extract unique internal URLs from crawl result."""
        from urllib.parse import urljoin, urlparse
        from bs4 import BeautifulSoup
        
        parsed_base = urlparse(base_url)
        base_domain = parsed_base.netloc
        
        internal_urls = set()
        
        # From links field
        for link in crawl_result.links:
            href = link.get("href", "")
            if link.get("type") == "internal" and href:
                full_url = urljoin(base_url, href)
                internal_urls.add(full_url)
        
        # Also parse HTML directly for more links
        if crawl_result.html:
            soup = BeautifulSoup(crawl_result.html, "lxml")
            for a in soup.find_all("a", href=True):
                href = a["href"]
                full_url = urljoin(base_url, href)
                parsed = urlparse(full_url)
                
                # Only include same-domain links
                if parsed.netloc == base_domain:
                    # Skip anchors, js, mailto
                    if not href.startswith(("#", "javascript:", "mailto:")):
                        internal_urls.add(full_url)
        
        # Remove the base URL itself
        internal_urls.discard(base_url)
        internal_urls.discard(base_url.rstrip("/"))
        
        return list(internal_urls)
    
    def _prioritize_mfa_paths(self, urls: list[str]) -> list[str]:
        """Prioritize URLs that match MFA-indicator path patterns."""
        from urllib.parse import urlparse
        
        # MFA-indicator path patterns (high priority)
        MFA_PATHS = [
            "/health/", "/education/", "/insurance/", "/loan/", "/legal/",
            "/crypto/", "/finance/", "/news/", "/amp/", "/tag/",
            "/category/", "/topic/", "/article/", "/page/2", "/page/3",
        ]
        
        priority_urls = []
        normal_urls = []
        
        for url in urls:
            path = urlparse(url).path.lower()
            is_mfa_path = any(pattern in path for pattern in MFA_PATHS)
            
            if is_mfa_path:
                priority_urls.append(url)
            else:
                normal_urls.append(url)
        
        # Return priority URLs first, then normal URLs
        return priority_urls + normal_urls
    
    def aggregate_results(self, results: list[CrawlResult]) -> dict[str, Any]:
        """
        Aggregate signals from multiple crawl results for site-level analysis.
        
        Returns summary metrics across all crawled pages.
        """
        if not results:
            return {}
        
        total_pages = len(results)
        successful = [r for r in results if not r.error]
        
        # Aggregate stats
        total_ads = sum(r.stats.get("totalAds", 0) for r in successful)
        total_popups = sum(r.stats.get("totalPopups", 0) for r in successful)
        total_videos = sum(r.stats.get("totalVideos", 0) for r in successful)
        ads_above_fold = sum(r.stats.get("adsAboveFold", 0) for r in successful)
        sticky_ads = sum(r.stats.get("stickyAds", 0) for r in successful)
        
        # Check policy pages across all pages
        has_privacy = any(r.policy_pages.get("privacy", False) for r in successful)
        has_terms = any(r.policy_pages.get("terms", False) for r in successful)
        has_contact = any(r.policy_pages.get("contact", False) for r in successful)
        
        # Detect template reuse (same ad layout across pages)
        ad_counts = [r.stats.get("totalAds", 0) for r in successful]
        template_reuse = len(set(ad_counts)) == 1 and len(ad_counts) > 1
        
        return {
            "total_pages_crawled": total_pages,
            "successful_crawls": len(successful),
            "failed_crawls": total_pages - len(successful),
            
            # Aggregated ad metrics
            "total_ads_across_pages": total_ads,
            "avg_ads_per_page": total_ads / len(successful) if successful else 0,
            "total_popups": total_popups,
            "total_videos": total_videos,
            "ads_above_fold": ads_above_fold,
            "sticky_ads": sticky_ads,
            
            # Policy compliance
            "has_privacy_policy": has_privacy,
            "has_terms": has_terms,
            "has_contact": has_contact,
            "policy_contents": {
                r.page_type: r.text for r in successful if r.page_type != "general"
            },
            
            # MFA indicators
            "template_reuse_detected": template_reuse,
            "mfa_path_count": sum(1 for r in successful if any(
                p in urlparse(r.url).path.lower() 
                for p in ["/health/", "/education/", "/insurance/", "/amp/"]
            )),
        }
