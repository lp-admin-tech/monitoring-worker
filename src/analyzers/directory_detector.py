"""
Directory Detector - Detects if a site is a directory/aggregator type.
Ported from JS worker's directory-detector.js
"""

import re
from typing import Any

from bs4 import BeautifulSoup

from src.utils.logger import get_logger

logger = get_logger(__name__)

# Patterns indicating directory/listicle sites
DIRECTORY_PATTERNS = {
    "url_patterns": [
        r"/directory/",
        r"/listings?/",
        r"/catalog/",
        r"/business-directory/",
        r"/yellow-pages/",
        r"/local-businesses/",
    ],
    "title_patterns": [
        r"directory",
        r"listings?",
        r"catalog",
        r"yellow pages",
        r"find businesses",
        r"local services",
    ],
    "content_patterns": [
        r"add your business",
        r"submit listing",
        r"claim your listing",
        r"business directory",
        r"find local",
        r"browse categor",
    ],
}

# Structural indicators of directory sites
DIRECTORY_STRUCTURAL_INDICATORS = [
    # Many similar card-like elements
    "div.listing-card",
    "div.business-card",
    "article.listing",
    "li.directory-item",
    # Pagination
    "nav.pagination",
    "div.pagination",
    # Category navigation
    "ul.category-list",
    "div.category-filter",
    # Search forms
    'form[action*="search"]',
    'input[placeholder*="Search"]',
]


class DirectoryDetector:
    """
    Detects directory/aggregator site patterns.
    
    Directory sites often have:
    - Many similar listing items
    - Category navigation
    - Search functionality
    - Little unique content per page
    """
    
    def __init__(self):
        self._url_patterns = [
            re.compile(p, re.IGNORECASE) 
            for p in DIRECTORY_PATTERNS["url_patterns"]
        ]
        self._title_patterns = [
            re.compile(p, re.IGNORECASE)
            for p in DIRECTORY_PATTERNS["title_patterns"]
        ]
        self._content_patterns = [
            re.compile(p, re.IGNORECASE)
            for p in DIRECTORY_PATTERNS["content_patterns"]
        ]
    
    def detect(
        self,
        url: str,
        html: str,
        title: str = "",
        text: str = "",
    ) -> dict[str, Any]:
        """
        Detect if a site is a directory/aggregator.
        
        Returns:
            Detection result with confidence score
        """
        logger.debug("Running directory detection", url=url)
        
        signals = {
            "url_match": False,
            "title_match": False,
            "content_match": False,
            "structural_match": False,
            "repetitive_structure": False,
        }
        
        # Check URL patterns
        for pattern in self._url_patterns:
            if pattern.search(url):
                signals["url_match"] = True
                break
        
        # Check title patterns
        for pattern in self._title_patterns:
            if pattern.search(title):
                signals["title_match"] = True
                break
        
        # Check content patterns
        text_sample = text[:5000]
        content_matches = 0
        for pattern in self._content_patterns:
            if pattern.search(text_sample):
                content_matches += 1
        signals["content_match"] = content_matches >= 2
        
        # Check structural indicators
        if html:
            structural = self._check_structural_indicators(html)
            signals["structural_match"] = structural["has_directory_structure"]
            signals["repetitive_structure"] = structural["has_repetitive_items"]
        
        # Calculate confidence
        confidence = self._calculate_confidence(signals)
        is_directory = confidence >= 0.6
        
        # Determine directory type
        directory_type = None
        if is_directory:
            directory_type = self._determine_type(url, title, text)
        
        return {
            "is_directory": is_directory,
            "confidence": round(confidence, 2),
            "directory_type": directory_type,
            "signals": signals,
        }
    
    def _check_structural_indicators(self, html: str) -> dict[str, bool]:
        """Check for structural patterns in HTML."""
        try:
            soup = BeautifulSoup(html, "lxml")
            
            # Check for directory-like selectors
            has_directory_structure = False
            for selector in DIRECTORY_STRUCTURAL_INDICATORS:
                if soup.select(selector):
                    has_directory_structure = True
                    break
            
            # Check for repetitive items (many similar elements)
            has_repetitive_items = False
            
            # Look for multiple similar cards/items
            common_item_selectors = [
                "div.card", "article.card", "li.item",
                "div.listing", "article.listing",
                "div[class*='item']", "div[class*='card']",
            ]
            
            for selector in common_item_selectors:
                items = soup.select(selector)
                if len(items) >= 10:  # Many similar items
                    has_repetitive_items = True
                    break
            
            return {
                "has_directory_structure": has_directory_structure,
                "has_repetitive_items": has_repetitive_items,
            }
        except Exception:
            return {
                "has_directory_structure": False,
                "has_repetitive_items": False,
            }
    
    def _calculate_confidence(self, signals: dict[str, bool]) -> float:
        """Calculate directory confidence score."""
        weights = {
            "url_match": 0.25,
            "title_match": 0.20,
            "content_match": 0.20,
            "structural_match": 0.20,
            "repetitive_structure": 0.15,
        }
        
        score = sum(
            weights[key] for key, value in signals.items() if value
        )
        
        return score
    
    def _determine_type(self, url: str, title: str, text: str) -> str:
        """Determine the type of directory."""
        combined = f"{url} {title} {text[:1000]}".lower()
        
        type_patterns = {
            "business_directory": [r"business", r"company", r"service provider"],
            "local_listings": [r"local", r"nearby", r"in your area"],
            "product_catalog": [r"product", r"shop", r"buy", r"price"],
            "aggregator": [r"news", r"article", r"story", r"latest"],
            "review_site": [r"review", r"rating", r"testimonial"],
        }
        
        for dir_type, patterns in type_patterns.items():
            matches = sum(1 for p in patterns if re.search(p, combined))
            if matches >= 2:
                return dir_type
        
        return "general_directory"


# Convenience instance
directory_detector = DirectoryDetector()
