"""
Technical Checker - Validates technical aspects of a site.
SSL, ads.txt, performance, domain intel.
"""

import asyncio
from typing import Any
from urllib.parse import urlparse

import httpx

from src.config import settings
from src.utils.logger import get_logger
from src.crawlers.audit_crawler import CrawlResult

logger = get_logger(__name__)


class TechnicalChecker:
    """
    Checks technical aspects:
    - SSL certificate validity
    - ads.txt presence and validity
    - Performance metrics
    - Domain age/reputation
    - Safe Browsing status
    """
    
    async def check(self, url: str, crawl_result: CrawlResult) -> dict[str, Any]:
        """Run all technical checks."""
        logger.info("Running technical checks", url=url)
        
        parsed = urlparse(url)
        domain = parsed.netloc or parsed.path
        
        try:
            # Run checks in parallel
            ssl_result, ads_txt_result, perf_result, https_result, broken_links_result = await asyncio.gather(
                self._check_ssl(domain),
                self._check_ads_txt(domain),
                self._analyze_performance(crawl_result),
                self._check_https_redirect(url),
                self._check_broken_links(crawl_result),
                return_exceptions=True,
            )
            
            # Handle any exceptions
            if isinstance(ssl_result, Exception):
                ssl_result = {"valid": False, "error": str(ssl_result)}
            if isinstance(ads_txt_result, Exception):
                ads_txt_result = {"present": False, "error": str(ads_txt_result)}
            if isinstance(perf_result, Exception):
                perf_result = {"error": str(perf_result)}
            if isinstance(https_result, Exception):
                https_result = {"redirects": False, "error": str(https_result)}
            if isinstance(broken_links_result, Exception):
                broken_links_result = {"broken_count": 0, "error": str(broken_links_result)}
            
            # Calculate overall technical health score
            health_score = self._calculate_health_score(
                ssl_result=ssl_result,
                ads_txt_result=ads_txt_result,
                perf_result=perf_result,
                broken_links_result=broken_links_result,
            )
            
            # Add navigation info from crawl result
            navigation_info = crawl_result.navigation if hasattr(crawl_result, "navigation") else {}
            
            return {
                "ssl": ssl_result,
                "ads_txt": ads_txt_result,
                "performance": perf_result,
                "https_redirect": https_result,
                "broken_links": broken_links_result,
                "navigation": navigation_info,
                "health_score": round(health_score, 2),
                "risk_level": self._get_risk_level(health_score),
            }
            
        except Exception as e:
            logger.error("Technical check failed", error=str(e))
            return {
                "ssl": {},
                "ads_txt": {},
                "performance": {},
                "health_score": 0,
                "risk_level": "high",
                "error": str(e),
            }
    
    async def _check_ssl(self, domain: str) -> dict[str, Any]:
        """Check SSL certificate validity."""
        # Run blocking SSL check in thread pool to avoid blocking event loop
        return await asyncio.to_thread(self._check_ssl_sync, domain)
    
    def _check_ssl_sync(self, domain: str) -> dict[str, Any]:
        """Synchronous SSL check implementation."""
        import ssl
        import socket
        from datetime import datetime, timezone
        
        try:
            context = ssl.create_default_context()
            
            with socket.create_connection((domain, 443), timeout=10) as sock:
                with context.wrap_socket(sock, server_hostname=domain) as ssock:
                    cert = ssock.getpeercert()
            
            # Parse certificate dates
            not_after = datetime.strptime(
                cert["notAfter"], "%b %d %H:%M:%S %Y %Z"
            ).replace(tzinfo=timezone.utc)
            not_before = datetime.strptime(
                cert["notBefore"], "%b %d %H:%M:%S %Y %Z"
            ).replace(tzinfo=timezone.utc)
            
            now = datetime.now(timezone.utc)
            days_until_expiry = (not_after - now).days
            
            return {
                "valid": True,
                "issuer": dict(cert.get("issuer", [[]])[0]) if cert.get("issuer") else {},
                "expires": not_after.isoformat(),
                "days_until_expiry": days_until_expiry,
                "is_expired": days_until_expiry < 0,
                "expiring_soon": 0 < days_until_expiry < 30,
            }
            
        except ssl.SSLError as e:
            return {"valid": False, "error": f"SSL error: {str(e)}"}
        except socket.timeout:
            return {"valid": False, "error": "Connection timeout"}
        except Exception as e:
            return {"valid": False, "error": str(e)}
    
    async def _check_ads_txt(self, domain: str) -> dict[str, Any]:
        """Check ads.txt presence and parse its contents."""
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                response = await client.get(f"https://{domain}/ads.txt")
                
                if response.status_code == 404:
                    return {"present": False, "reason": "Not found (404)"}
                
                if response.status_code != 200:
                    return {"present": False, "reason": f"HTTP {response.status_code}"}
                
                content = response.text
                
                # Parse ads.txt
                parsed = self._parse_ads_txt(content)
                
                return {
                    "present": True,
                    "record_count": parsed["record_count"],
                    "sellers": parsed["sellers"],
                    "has_google": parsed["has_google"],
                    "is_valid": parsed["is_valid"],
                    "errors": parsed["errors"],
                }
                
        except httpx.TimeoutException:
            return {"present": False, "error": "Request timeout"}
        except Exception as e:
            return {"present": False, "error": str(e)}
    
    async def _check_https_redirect(self, url: str) -> dict[str, Any]:
        """Check if HTTP redirects to HTTPS properly."""
        try:
            # Only test if URL is HTTPS - convert to HTTP to test redirect
            if not url.startswith("https://"):
                return {"redirects": True, "note": "URL is already HTTP"}
            
            http_url = url.replace("https://", "http://")
            
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                response = await client.get(http_url)
                
                # Check final URL scheme
                final_url = str(response.url)
                redirects_to_https = final_url.startswith("https://")
                
                # Collect redirect chain
                redirect_chain = []
                for r in response.history:
                    redirect_chain.append({
                        "url": str(r.url),
                        "status": r.status_code
                    })
                
                return {
                    "redirects_to_https": redirects_to_https,
                    "final_url": final_url,
                    "redirect_count": len(redirect_chain),
                    "redirect_chain": redirect_chain[:5],  # Limit to first 5
                }
                
        except httpx.TimeoutException:
            return {"redirects_to_https": False, "error": "Timeout"}
        except Exception as e:
            return {"redirects_to_https": False, "error": str(e)}
    
    def _parse_ads_txt(self, content: str) -> dict[str, Any]:
        """Parse ads.txt content according to IAB specification."""
        lines = content.strip().split("\n")
        records = []
        errors = []
        sellers = []
        has_google = False
        
        for i, line in enumerate(lines):
            line = line.strip()
            
            # Skip comments and empty lines
            if not line or line.startswith("#"):
                continue
            
            # Check for variables (e.g., contact=)
            if "=" in line and "," not in line:
                continue
            
            # Parse record: domain, publisher_id, relationship, [certification_authority_id]
            parts = [p.strip() for p in line.split(",")]
            
            if len(parts) < 3:
                errors.append(f"Line {i+1}: Invalid format")
                continue
            
            domain, pub_id, relationship = parts[0], parts[1], parts[2].upper()
            
            if relationship not in ["DIRECT", "RESELLER"]:
                errors.append(f"Line {i+1}: Invalid relationship type")
                continue
            
            record = {
                "domain": domain,
                "publisher_id": pub_id,
                "relationship": relationship,
            }
            
            if len(parts) >= 4:
                record["certification_authority_id"] = parts[3]
            
            records.append(record)
            sellers.append(domain)
            
            if "google" in domain.lower():
                has_google = True
        
        return {
            "record_count": len(records),
            "sellers": list(set(sellers))[:10],  # Top 10 unique sellers
            "has_google": has_google,
            "is_valid": len(records) > 0 and len(errors) < 5,
            "errors": errors[:5],  # First 5 errors
        }
    
    async def _analyze_performance(self, crawl_result: CrawlResult) -> dict[str, Any]:
        """Analyze page performance from crawl data."""
        # Calculate metrics from crawl result
        load_time = crawl_result.load_time_ms
        request_count = crawl_result.total_requests or len(crawl_result.requests)
        script_count = len(crawl_result.scripts)
        
        # Heuristic performance score
        score = 100.0
        
        # Penalize slow load time
        if load_time > 5000:
            score -= 30
        elif load_time > 3000:
            score -= 15
        elif load_time > 1500:
            score -= 5
        
        # Penalize too many requests
        if request_count > 100:
            score -= 20
        elif request_count > 50:
            score -= 10
        
        # Penalize too many scripts
        if script_count > 20:
            score -= 15
        elif script_count > 10:
            score -= 5
        
        return {
            "load_time_ms": load_time,
            "request_count": request_count,
            "script_count": script_count,
            "performance_score": max(0, round(score, 2)),
        }
    
    async def _check_broken_links(self, crawl_result: CrawlResult) -> dict[str, Any]:
        """Check for broken internal links (404s)."""
        internal_links = [l.get("href") for l in crawl_result.links if l.get("type") == "internal"]
        if not internal_links:
            return {"broken_count": 0, "checked_count": 0, "score": 100}
            
        # Limit to 10 links to avoid excessive requests
        to_check = internal_links[:10]
        broken = []
        
        async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
            tasks = [client.get(url) for url in to_check if url.startswith("http")]
            responses = await asyncio.gather(*tasks, return_exceptions=True)
            
            for i, resp in enumerate(responses):
                if isinstance(resp, Exception) or resp.status_code >= 400:
                    broken.append({
                        "url": to_check[i],
                        "status": getattr(resp, "status_code", "Error")
                    })
                    
        score = 100 - (len(broken) * 20)
        return {
            "broken_count": len(broken),
            "checked_count": len(to_check),
            "broken_links": broken,
            "score": max(0, score),
        }
    
    def _calculate_health_score(
        self,
        ssl_result: dict[str, Any],
        ads_txt_result: dict[str, Any],
        perf_result: dict[str, Any],
        broken_links_result: dict[str, Any],
    ) -> float:
        """Calculate overall technical health score (0-100)."""
        score = 0.0
        weights = {"ssl": 0.2, "ads_txt": 0.2, "performance": 0.4, "broken_links": 0.2}
        
        # SSL score
        if ssl_result.get("valid"):
            ssl_score = 100
            if ssl_result.get("expiring_soon"):
                ssl_score = 70
        else:
            ssl_score = 0
        score += ssl_score * weights["ssl"]
        
        # ads.txt score
        if ads_txt_result.get("present") and ads_txt_result.get("is_valid"):
            ads_score = 100
        elif ads_txt_result.get("present"):
            ads_score = 60
        else:
            ads_score = 30
        score += ads_score * weights["ads_txt"]
        
        # Performance score
        perf_score = perf_result.get("performance_score", 50)
        score += perf_score * weights["performance"]
        
        # Broken links score
        broken_score = broken_links_result.get("score", 100)
        score += broken_score * weights["broken_links"]
        
        return score
    
    def _get_risk_level(self, health_score: float) -> str:
        """Map health score to risk level (inverted)."""
        if health_score >= 70:
            return "low"
        elif health_score >= 40:
            return "medium"
        else:
            return "high"
