"""
Content Analyzer - Analyzes page content quality for MFA detection.
Uses textstat for readability metrics and custom logic for spam detection.
"""

import re
import math
from typing import Any

from src.utils.logger import get_logger
from src.crawlers.audit_crawler import CrawlResult

logger = get_logger(__name__)


class ContentAnalyzer:
    """
    Analyzes content quality indicators:
    - Readability scores (Flesch-Kincaid, Gunning Fog)
    - Text entropy (Shannon entropy)
    - AI-generated content likelihood
    - Clickbait detection
    - Thin content detection
    - Scraped/Placeholder content detection
    - Information density
    """
    
    # Clickbait patterns
    CLICKBAIT_PATTERNS = [
        r"you won't believe",
        r"this will shock you",
        r"the reason why",
        r"what happens next",
        r"number \d+ will",
        r"doctors hate",
        r"one weird trick",
        r"click here to find out",
        r"you need to see this",
        r"before it's deleted",
        r"breaking:",
        r"exclusive:",
        r"shocking:",
    ]
    
    async def analyze(self, crawl_result: CrawlResult) -> dict[str, Any]:
        """Analyze content quality from crawl result."""
        logger.info("Analyzing content", url=crawl_result.url)
        
        text = crawl_result.text or crawl_result.markdown or ""
        title = crawl_result.title or ""
        html = crawl_result.html or ""
        
        if not text:
            logger.warning("No content found for analysis", url=crawl_result.url, html_len=len(html))
            return self._empty_result(error="No content found")
        
        try:
            import textstat
            
            # Basic metrics
            word_count = len(text.split())
            sentence_count = textstat.sentence_count(text)
            text_length = len(text)
            
            # Readability scores
            flesch_score = textstat.flesch_reading_ease(text)
            flesch_grade = textstat.flesch_kincaid_grade(text)
            gunning_fog = textstat.gunning_fog(text)
            smog_index = textstat.smog_index(text)
            
            readability = {
                "flesch_reading_ease": round(flesch_score, 2),
                "flesch_kincaid_grade": round(flesch_grade, 2),
                "gunning_fog": round(gunning_fog, 2),
                "smog_index": round(smog_index, 2),
            }
            
            # Content quality metrics
            entropy = self._calculate_entropy(text)
            clickbait_score = self._calculate_clickbait_score(title, text)
            thin_content = self._detect_thin_content(text, word_count)
            ai_score = self._estimate_ai_likelihood(text)
            
            # Detect scraped/placeholder content
            scraped_content = self._detect_scraped_content(text, html)
            
            # Calculate information density
            info_density = self._calculate_information_density(text)
            
            # Detect freshness
            freshness = self._detect_freshness(text, html)
            
            # Calculate overall content risk
            risk_score = self._calculate_risk_score(
                readability=readability,
                entropy=entropy,
                clickbait_score=clickbait_score,
                ai_score=ai_score,
                scraped_content=scraped_content,
                info_density=info_density,
            )
            
            return {
                "text_length": text_length,
                "word_count": word_count,
                "sentence_count": sentence_count,
                "readability": readability,
                "entropy": round(entropy, 3),
                "clickbait_score": round(clickbait_score, 2),
                "ai_generated_likelihood": round(ai_score, 2),
                
                "scraped_content": scraped_content,
                "information_density": round(info_density, 3),
                "freshness": freshness,
                "thin_content": thin_content,
                
                "risk_score": round(risk_score, 2),
                "risk_level": self._get_risk_level(risk_score),
            }
            
        except Exception as e:
            logger.error("Content analysis failed", error=str(e))
            return self._empty_result(error=str(e))
    
    def _calculate_entropy(self, text: str) -> float:
        """Calculate Shannon entropy of text (higher = more random/diverse)."""
        if not text:
            return 0.0
        
        # Character-level entropy
        text = text.lower()
        freq = {}
        for char in text:
            freq[char] = freq.get(char, 0) + 1
        
        total = len(text)
        entropy = 0.0
        for count in freq.values():
            p = count / total
            if p > 0:
                entropy -= p * math.log2(p)
        
        return entropy
    
    def _calculate_clickbait_score(self, title: str, text: str) -> float:
        """Score clickbait likelihood (0-1)."""
        combined = f"{title} {text[:500]}".lower()
        matches = 0
        
        for pattern in self.CLICKBAIT_PATTERNS:
            if re.search(pattern, combined, re.IGNORECASE):
                matches += 1
        
        # Normalize to 0-1 (cap at 5 matches = 1.0)
        return min(matches / 5, 1.0)
    
    def _detect_thin_content(self, text: str, word_count: int) -> dict[str, Any]:
        """Detect thin/low-value content."""
        is_thin = word_count < 300
        
        # Check for repetitive phrases
        words = text.lower().split()
        unique_ratio = len(set(words)) / max(len(words), 1)
        
        return {
            "is_thin": is_thin,
            "word_count": word_count,
            "unique_word_ratio": round(unique_ratio, 2),
            "reason": "Low word count" if is_thin else None,
        }
    
    def _estimate_ai_likelihood(self, text: str) -> float:
        """
        Simple heuristic for AI-generated content detection.
        """
        if not text or len(text) < 200:
            return 0.0
        
        sentences = re.split(r'[.!?]+', text)
        sentences = [s.strip() for s in sentences if s.strip()]
        
        if len(sentences) < 5:
            return 0.0
        
        # Check sentence length variance (AI = lower variance)
        lengths = [len(s.split()) for s in sentences]
        if not lengths:
            return 0.0
        
        mean_len = sum(lengths) / len(lengths)
        variance = sum((x - mean_len) ** 2 for x in lengths) / len(lengths)
        std_dev = math.sqrt(variance)
        
        # Low variance = more likely AI
        variance_score = max(0, 1 - (std_dev / 10))
        
        # Check for personal pronouns
        personal_count = len(re.findall(r'\b(i|my|me|we|our)\b', text.lower()))
        personal_ratio = personal_count / len(text.split())
        
        # Low personal pronouns = more likely AI
        personal_score = max(0, 1 - (personal_ratio * 20))
        
        return (variance_score * 0.6 + personal_score * 0.4)

    def _detect_scraped_content(self, text: str, html: str) -> dict[str, Any]:
        """Detect signs of scraped, placeholder, or template content."""
        text_lower = text.lower()
        patterns = []
        
        # 1. Placeholder text
        placeholders = ["lorem ipsum", "dolor sit amet", "placeholder text", "sample text"]
        for p in placeholders:
            if p in text_lower:
                patterns.append(f"placeholder_found: {p}")
        
        # 2. Broken template tags
        template_tags = [r"\{\{.*\}\}", r"\[\[.*\]\]", r"%%.*%%", r"\{\%.*\%\}"]
        import re
        for tag in template_tags:
            if re.search(tag, html):
                patterns.append("broken_template_tag")
                break
        
        # 3. Common scraped content markers
        scraped_markers = ["source:", "originally published on", "read more at", "copyright (c) 20"]
        for marker in scraped_markers:
            if marker in text_lower:
                patterns.append(f"scraped_marker: {marker}")
        
        # 4. Repetitive phrases (keyword stuffing)
        words = text_lower.split()
        if len(words) > 50:
            from collections import Counter
            word_counts = Counter(words)
            top_words = word_counts.most_common(5)
            for word, count in top_words:
                if len(word) > 3 and count / len(words) > 0.08:
                    patterns.append(f"keyword_stuffing: {word}")
        
        return {
            "is_scraped": len(patterns) > 0,
            "patterns": patterns,
            "score": min(len(patterns) * 0.3, 1.0)
        }

    def _calculate_information_density(self, text: str) -> float:
        """Calculate information density based on unique long words ratio."""
        if not text or len(text) < 100:
            return 0.0
            
        words = text.lower().split()
        if not words:
            return 0.0
            
        long_words = [w for w in words if len(w) > 5]
        if not long_words:
            return 0.1
            
        unique_long_words = set(long_words)
        density = len(unique_long_words) / len(words)
        
        # Normalize: 0.1 is low, 0.3 is high
        return min(max((density - 0.05) / 0.25, 0.0), 1.0)

    def _detect_freshness(self, text: str, html: str) -> dict[str, Any]:
        """Detect content publish/update date for freshness scoring."""
        from bs4 import BeautifulSoup
        from datetime import datetime, timezone
        import re
        
        if not html:
            return {"freshness_score": 0, "publish_date": None, "reason": "No HTML"}
        
        soup = BeautifulSoup(html, "lxml")
        
        # Meta tags commonly used for publish dates
        date_metas = [
            ("property", "article:published_time"),
            ("property", "article:modified_time"),
            ("name", "datePublished"),
            ("name", "date"),
            ("name", "pubdate"),
            ("name", "DC.date.issued"),
            ("property", "og:updated_time"),
            ("itemprop", "datePublished"),
        ]
        
        for attr_type, attr_value in date_metas:
            meta = soup.find("meta", attrs={attr_type: attr_value})
            if meta and meta.get("content"):
                try:
                    date_str = meta["content"]
                    # Handle various ISO format variations
                    date_str = date_str.replace("Z", "+00:00")
                    if "T" not in date_str and len(date_str) == 10:
                        date_str += "T00:00:00+00:00"
                    
                    pub_date = datetime.fromisoformat(date_str)
                    if pub_date.tzinfo is None:
                        pub_date = pub_date.replace(tzinfo=timezone.utc)
                    
                    days_old = (datetime.now(timezone.utc) - pub_date).days
                    
                    # Score: 100 = today, 0 = 365+ days old
                    freshness_score = max(0, min(100, 100 - (days_old / 3.65)))
                    
                    return {
                        "freshness_score": round(freshness_score, 2),
                        "publish_date": pub_date.isoformat(),
                        "days_old": days_old,
                        "source": attr_value,
                    }
                except (ValueError, TypeError):
                    continue
        
        # Try to find time elements with datetime
        time_element = soup.find("time", attrs={"datetime": True})
        if time_element and time_element.get("datetime"):
            try:
                date_str = time_element["datetime"].replace("Z", "+00:00")
                pub_date = datetime.fromisoformat(date_str)
                if pub_date.tzinfo is None:
                    pub_date = pub_date.replace(tzinfo=timezone.utc)
                days_old = (datetime.now(timezone.utc) - pub_date).days
                freshness_score = max(0, min(100, 100 - (days_old / 3.65)))
                
                return {
                    "freshness_score": round(freshness_score, 2),
                    "publish_date": pub_date.isoformat(),
                    "days_old": days_old,
                    "source": "time_element",
                }
            except (ValueError, TypeError):
                pass
        
        # Try to find date patterns in text
        date_pattern = r'(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})|([A-Z][a-z]+ \d{1,2}, \d{4})'
        match = re.search(date_pattern, text)
        if match:
            return {"freshness_score": 70, "publish_date": match.group(0), "reason": "Date pattern found in text"}
            
        return {"freshness_score": 50, "publish_date": None, "reason": "No date found"}

    def _calculate_risk_score(
        self,
        readability: dict[str, Any],
        entropy: float,
        clickbait_score: float,
        ai_score: float,
        scraped_content: dict[str, Any] = None,
        info_density: float = 0.5,
    ) -> float:
        """Calculate overall content risk score (0-1)."""
        risk = 0.0
        
        # 1. Readability risk (too simple or too complex)
        flesch = readability.get("flesch_kincaid_grade", 8)
        if flesch < 4 or flesch > 20:
            risk += 0.2
            
        # 2. Entropy risk (low entropy = repetitive/templated)
        if entropy < 4.0:
            risk += 0.3
        elif entropy < 4.5:
            risk += 0.15
            
        # 3. Clickbait risk
        risk += clickbait_score * 0.3
        
        # 4. AI risk
        risk += ai_score * 0.2
        
        # 5. Scraped content risk
        if scraped_content and scraped_content.get("is_scraped"):
            risk += scraped_content.get("score", 0) * 0.4
            
        # 6. Information density risk (low density = fluff)
        if info_density < 0.2:
            risk += 0.2
            
        return min(risk, 1.0)
    
    def _get_risk_level(self, risk_score: float) -> str:
        """Map risk score to risk level."""
        if risk_score <= 0.3:
            return "low"
        elif risk_score <= 0.6:
            return "medium"
        else:
            return "high"
    
    def _empty_result(self, error: str | None = None) -> dict[str, Any]:
        """Return empty result structure."""
        return {
            "text_length": 0,
            "word_count": 0,
            "sentence_count": 0,
            "readability": {},
            "entropy": 0,
            "clickbait_score": 0,
            "ai_generated_likelihood": 0,
            "scraped_content": {"is_scraped": False, "patterns": []},
            "information_density": 0,
            "freshness": {"freshness_score": 0, "publish_date": None},
            "thin_content": {"is_thin": True, "word_count": 0},
            "risk_score": 1.0,
            "risk_level": "high",
            "error": error,
        }
