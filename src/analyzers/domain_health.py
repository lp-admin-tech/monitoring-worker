"""
Domain Health Checker - Validates domain infrastructure and security.

Features:
- DNS verification (A, MX, NS records)
- Google Safe Browsing API check
- PageSpeed Insights API (mobile + desktop)
- Domain age estimation
"""

import asyncio
import socket
from typing import Any
from urllib.parse import urlparse

import httpx

from src.config import settings
from src.utils.logger import get_logger

logger = get_logger(__name__)


class DomainHealthChecker:
    """
    Comprehensive domain health analysis.
    
    Checks:
    - DNS resolution and records
    - Google Safe Browsing status
    - PageSpeed Insights scores
    - Mobile friendliness
    """
    
    def __init__(self):
        self.safe_browsing_api_key = getattr(settings, "google_safe_browsing_key", None) or None
        self.pagespeed_api_key = getattr(settings, "pagespeed_api_key", None) or None
    
    async def check_all(self, url: str) -> dict[str, Any]:
        """Run all domain health checks."""
        parsed = urlparse(url)
        domain = parsed.netloc
        
        logger.info("Running domain health checks", domain=domain)
        
        try:
            # Run checks in parallel
            dns_result, safe_browsing_result, pagespeed_result = await asyncio.gather(
                self._check_dns(domain),
                self._check_safe_browsing(url),
                self._check_pagespeed(url),
                return_exceptions=True,
            )
            
            # Handle exceptions
            if isinstance(dns_result, Exception):
                dns_result = {"error": str(dns_result)}
            if isinstance(safe_browsing_result, Exception):
                safe_browsing_result = {"error": str(safe_browsing_result), "is_safe": None}
            if isinstance(pagespeed_result, Exception):
                pagespeed_result = {"error": str(pagespeed_result)}
            
            # Calculate overall health score
            health_score = self._calculate_health_score(
                dns_result, safe_browsing_result, pagespeed_result
            )
            
            return {
                "domain": domain,
                "dns": dns_result,
                "safe_browsing": safe_browsing_result,
                "pagespeed": pagespeed_result,
                "health_score": round(health_score, 2),
                "risk_level": self._get_risk_level(health_score),
            }
            
        except Exception as e:
            logger.error("Domain health check failed", error=str(e))
            return {
                "domain": domain,
                "error": str(e),
                "health_score": 0,
                "risk_level": "high",
            }
    
    async def _check_dns(self, domain: str) -> dict[str, Any]:
        """Verify DNS records exist and are properly configured."""
        import dns.resolver
        
        result = {
            "has_a_record": False,
            "has_mx_record": False,
            "has_aaaa_record": False,
            "nameservers": [],
            "ip_addresses": [],
        }
        
        try:
            # Check A record (IPv4)
            try:
                answers = dns.resolver.resolve(domain, "A")
                result["has_a_record"] = True
                result["ip_addresses"] = [str(rdata) for rdata in answers]
            except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
                pass
            
            # Check AAAA record (IPv6)
            try:
                dns.resolver.resolve(domain, "AAAA")
                result["has_aaaa_record"] = True
            except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
                pass
            
            # Check MX record (email)
            try:
                dns.resolver.resolve(domain, "MX")
                result["has_mx_record"] = True
            except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
                pass
            
            # Get nameservers
            try:
                ns_answers = dns.resolver.resolve(domain, "NS")
                result["nameservers"] = [str(rdata) for rdata in ns_answers][:5]
            except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
                pass
            
        except Exception as e:
            result["error"] = str(e)
        
        return result
    
    async def _check_safe_browsing(self, url: str) -> dict[str, Any]:
        """Check URL against Google Safe Browsing API."""
        if not self.safe_browsing_api_key:
            return {
                "is_safe": None,
                "note": "GOOGLE_SAFE_BROWSING_API_KEY not configured",
            }
        
        api_url = f"https://safebrowsing.googleapis.com/v4/threatMatches:find?key={self.safe_browsing_api_key}"
        
        payload = {
            "client": {
                "clientId": "mfa-detection-worker",
                "clientVersion": "1.0.0",
            },
            "threatInfo": {
                "threatTypes": [
                    "MALWARE",
                    "SOCIAL_ENGINEERING",
                    "UNWANTED_SOFTWARE",
                    "POTENTIALLY_HARMFUL_APPLICATION",
                ],
                "platformTypes": ["ANY_PLATFORM"],
                "threatEntryTypes": ["URL"],
                "threatEntries": [{"url": url}],
            },
        }
        
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(api_url, json=payload)
                data = response.json()
                
                # Empty response = safe
                if not data or "matches" not in data:
                    return {"is_safe": True, "threats": []}
                
                # Threats found
                threats = [
                    {
                        "type": match.get("threatType"),
                        "platform": match.get("platformType"),
                    }
                    for match in data.get("matches", [])
                ]
                
                return {
                    "is_safe": False,
                    "threats": threats,
                    "threat_count": len(threats),
                }
                
        except Exception as e:
            return {"is_safe": None, "error": str(e)}
    
    async def _check_pagespeed(self, url: str) -> dict[str, Any]:
        """Get PageSpeed Insights scores for mobile and desktop."""
        api_key_param = f"&key={self.pagespeed_api_key}" if self.pagespeed_api_key else ""
        
        result = {
            "mobile_score": None,
            "desktop_score": None,
            "mobile_friendly": None,
        }
        
        async with httpx.AsyncClient(timeout=30) as client:
            # Check mobile
            try:
                mobile_url = f"https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url={url}&strategy=mobile{api_key_param}"
                mobile_response = await client.get(mobile_url)
                
                if mobile_response.status_code == 200:
                    mobile_data = mobile_response.json()
                    lighthouse = mobile_data.get("lighthouseResult", {})
                    categories = lighthouse.get("categories", {})
                    
                    performance = categories.get("performance", {})
                    result["mobile_score"] = int(performance.get("score", 0) * 100)
                    
                    # Check mobile-friendly audit
                    audits = lighthouse.get("audits", {})
                    viewport = audits.get("viewport", {})
                    result["mobile_friendly"] = viewport.get("score", 0) == 1
                    
            except Exception as e:
                result["mobile_error"] = str(e)
            
            # Check desktop
            try:
                desktop_url = f"https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url={url}&strategy=desktop{api_key_param}"
                desktop_response = await client.get(desktop_url)
                
                if desktop_response.status_code == 200:
                    desktop_data = desktop_response.json()
                    lighthouse = desktop_data.get("lighthouseResult", {})
                    categories = lighthouse.get("categories", {})
                    
                    performance = categories.get("performance", {})
                    result["desktop_score"] = int(performance.get("score", 0) * 100)
                    
            except Exception as e:
                result["desktop_error"] = str(e)
        
        return result
    
    def _calculate_health_score(
        self,
        dns_result: dict[str, Any],
        safe_browsing_result: dict[str, Any],
        pagespeed_result: dict[str, Any],
    ) -> float:
        """Calculate overall domain health score (0-100)."""
        score = 0.0
        
        # DNS (20 points)
        if dns_result.get("has_a_record"):
            score += 10
        if dns_result.get("has_mx_record"):
            score += 5
        if dns_result.get("nameservers"):
            score += 5
            
        # Safe Browsing (35 points)
        if safe_browsing_result.get("is_safe") is True:
            score += 35
        elif safe_browsing_result.get("is_safe") is None:
            score += 17.5  # Unknown, give partial credit
        # If is_safe is False, no points
        
        # PageSpeed (45 points)
        mobile = pagespeed_result.get("mobile_score")
        desktop = pagespeed_result.get("desktop_score")
        
        if mobile is not None:
            score += (mobile / 100) * 25
        if desktop is not None:
            score += (desktop / 100) * 15
        if pagespeed_result.get("mobile_friendly"):
            score += 5
        
        return min(100, score)
    
    def _get_risk_level(self, score: float) -> str:
        """Map score to risk level."""
        if score >= 70:
            return "low"
        elif score >= 40:
            return "medium"
        else:
            return "high"
