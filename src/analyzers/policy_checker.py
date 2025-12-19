"""
Policy Checker - Validates content against Google Ad Manager policies.
Detects content that could cause Google account closure.

Based on:
- Google AdSense Publisher Policies
- Google Ad Manager Content Guidelines
- Google Ads Prohibited Content Policies

Purpose:
- Prevent MCM parent account from policy violations
- Flag content that could cause account closure
- Ensure advertiser brand safety
"""

import re
from typing import Any
from urllib.parse import urlparse

from src.utils.logger import get_logger

logger = get_logger(__name__)


# Google Publisher Policies (2024)
# Based on official Google AdSense/Ad Manager policies
# PROHIBITED = Account closure risk, RESTRICTED = Reduced ad serving

# PROHIBITED CONTENT - CAN CAUSE IMMEDIATE ACCOUNT CLOSURE
PROHIBITED_CATEGORIES = {
    "adult_explicit": {
        "keywords": [
            r"\bporn\b", r"\bxxx\b", r"\bnsfw\b", r"\bnude\b", r"\bescort\b",
            r"\berotic\b", r"\badult\s+content\b", r"\bsex\s+toys?\b",
            r"\bpornograph", r"\bexplicit\s+content\b",
        ],
        "severity": "critical",
        "account_closure_risk": True,
        "google_policy": "Sexually explicit content",
    },
    "child_exploitation": {
        "keywords": [
            r"\bchild\s+abuse\b", r"\bminor\s+exploit", r"\bcsam\b",
            r"\bunderage\b", r"\bpedophil",
        ],
        "severity": "critical",
        "account_closure_risk": True,
        "google_policy": "Child sexual abuse and exploitation",
    },
    "illegal_content": {
        "keywords": [
            r"\billegal\s+download", r"\bpirat(?:e|ed|ing)\b", r"\bcracked\s+software\b",
            r"\btorrent\b", r"\bhuman\s+trafficking\b",
        ],
        "severity": "critical",
        "account_closure_risk": True,
        "google_policy": "Illegal content policy",
    },
    "malware": {
        "keywords": [
            r"\bmalware\b", r"\btrojan\b", r"\bkeylogger\b", r"\bspyware\b",
            r"\bhack(?:ing)?\s+tools?\b", r"\bexploit\s+kit\b", r"\bransomware\b",
        ],
        "severity": "critical",
        "account_closure_risk": True,
        "google_policy": "Malicious or unwanted software",
    },
    "hate_speech": {
        "keywords": [
            r"\bhate\s+speech\b", r"\bracist\b", r"\bbigot", r"\bwhite\s+supremac",
            r"\bdiscrimination\b", r"\bxenophob", r"\bhomophob", r"\banti-semit",
        ],
        "severity": "critical",
        "account_closure_risk": True,
        "google_policy": "Hateful content policy",
    },
    "dangerous_content": {
        "keywords": [
            r"\bterroris[tm]\b", r"\bbomb\s+making\b", r"\bself[- ]?harm\b",
            r"\bsuicide\s+method", r"\bincit(?:e|ing)\s+violence\b",
        ],
        "severity": "critical",
        "account_closure_risk": True,
        "google_policy": "Dangerous or derogatory content",
    },
    "copyright_infringement": {
        "keywords": [
            r"\bcopyright\s+infring", r"\bstolen\s+content\b", r"\bplagiaris",
            r"\bDMCA\s+takedown\b",
        ],
        "severity": "high",
        "account_closure_risk": True,
        "google_policy": "Intellectual property abuse",
    },
    "animal_cruelty": {
        "keywords": [
            r"\banimal\s+cruelty\b", r"\banimal\s+abuse\b", r"\bdog\s+fight",
            r"\bcockfight",
        ],
        "severity": "high",
        "account_closure_risk": True,
        "google_policy": "Animal cruelty policy",
    },
}

# RESTRICTED CONTENT - Reduced ad serving (some advertisers block)
RESTRICTED_CATEGORIES = {
    "alcohol": {
        "keywords": [
            r"\balcohol\b", r"\bbeer\b", r"\bwine\b", r"\bwhisk(?:e)?y\b",
            r"\bvodka\b", r"\bliquor\b", r"\bspirits\b",
        ],
        "severity": "medium",
        "account_closure_risk": False,
        "google_policy": "Alcohol sale or misuse",
    },
    "gambling": {
        "keywords": [
            r"\bcasino\b", r"\bbet(?:ting)?\b", r"\bpoker\b", r"\bslots?\b",
            r"\bgambling\b", r"\bsportsbook\b", r"\bwager\b", r"\bbookmaker\b",
        ],
        "severity": "high",
        "account_closure_risk": True,  # Only if unlicensed
        "google_policy": "Gambling and games policy",
    },
    "drugs_recreational": {
        "keywords": [
            r"\bcannabis\b", r"\bmarijuana\b", r"\bweed\b", r"\bcbd\b",
            r"\bthc\b", r"\bkratom\b", r"\bpsilocybin\b",
        ],
        "severity": "high",
        "account_closure_risk": True,
        "google_policy": "Recreational drugs policy",
    },
    "drugs_prescription": {
        "keywords": [
            r"\bprescription\s+drugs?\b", r"\bonline\s+pharmacy\b",
            r"\bbuy\s+\w+\s+online\b",  # Buy [drug] online
        ],
        "severity": "high",
        "account_closure_risk": True,
        "google_policy": "Unapproved pharmaceuticals",
    },
    "weapons": {
        "keywords": [
            r"\bguns?\b", r"\bfirearms?\b", r"\bammunition\b", r"\bweapons?\b",
            r"\bexplosives?\b", r"\bknives?\b", r"\bgun\s+parts?\b",
        ],
        "severity": "high",
        "account_closure_risk": False,
        "google_policy": "Weapons policy",
    },
    "tobacco": {
        "keywords": [
            r"\btobacco\b", r"\bcigarett", r"\bvaping\b", r"\be[- ]?cig\b",
            r"\bnicotine\b", r"\bsmok(?:e|ing)\b",
        ],
        "severity": "medium",
        "account_closure_risk": False,
        "google_policy": "Tobacco policy",
    },
    "violence_graphic": {
        "keywords": [
            r"\bgore\b", r"\bviolent\s+content\b", r"\btorture\b",
            r"\bgraphic\s+violence\b", r"\bblood\b", r"\bmutilation\b",
        ],
        "severity": "high",
        "account_closure_risk": False,
        "google_policy": "Shocking content",
    },
    "misinformation": {
        "keywords": [
            r"\bfake\s+news\b", r"\bconspiracy\b", r"\bhoax\b",
            r"\bmisinformation\b", r"\bdisinformation\b", r"\bdeepfake\b",
        ],
        "severity": "medium",
        "account_closure_risk": False,
        "google_policy": "Misleading content policy",
    },
    "counterfeit": {
        "keywords": [
            r"\breplica\b", r"\bcounterfeit\b", r"\bknockoff\b",
            r"\bfake\s+\w+\s+brand\b", r"\bimitation\b",
        ],
        "severity": "high",
        "account_closure_risk": True,
        "google_policy": "Counterfeit goods policy",
    },
}

# Combine all categories for scanning
ALL_POLICY_CATEGORIES = {**PROHIBITED_CATEGORIES, **RESTRICTED_CATEGORIES}

# Content categories for classification
CONTENT_CATEGORIES = {
    "news": [r"\bnews\b", r"\bbreaking\b", r"\bheadlines?\b", r"\breporter\b"],
    "entertainment": [r"\bmovies?\b", r"\bcelebrit", r"\btv\s+shows?\b", r"\bgossip\b"],
    "technology": [r"\btech\b", r"\bgadgets?\b", r"\bsmartphones?\b", r"\bsoftware\b"],
    "health": [r"\bhealth\b", r"\bmedical\b", r"\bwellness\b", r"\bdiet\b"],
    "finance": [r"\bfinance\b", r"\binvest", r"\bstocks?\b", r"\bcrypto\b"],
    "sports": [r"\bsports?\b", r"\bfootball\b", r"\bbasketball\b", r"\bsoccer\b"],
    "lifestyle": [r"\blifestyle\b", r"\bfashion\b", r"\btravel\b", r"\bfood\b"],
}

# TLD to jurisdiction mapping
TLD_JURISDICTION = {
    ".com": "US",
    ".co.uk": "UK",
    ".uk": "UK",
    ".de": "DE",
    ".fr": "FR",
    ".ca": "CA",
    ".au": "AU",
    ".in": "IN",
    ".jp": "JP",
    ".cn": "CN",
}


class PolicyChecker:
    """
    Checks content against advertising policies.
    
    Features:
    - Restricted keyword scanning
    - Content categorization
    - Jurisdiction detection
    - Compliance scoring
    """
    
    def __init__(self):
        # Compile all patterns
        self._restricted_patterns = {}
        for category, data in RESTRICTED_CATEGORIES.items():
            self._restricted_patterns[category] = {
                "patterns": [re.compile(p, re.IGNORECASE) for p in data["keywords"]],
                "severity": data["severity"],
            }
        
        self._category_patterns = {}
        for category, patterns in CONTENT_CATEGORIES.items():
            self._category_patterns[category] = [
                re.compile(p, re.IGNORECASE) for p in patterns
            ]
    
    async def check(
        self,
        url: str,
        text: str,
        title: str = "",
        policy_pages: dict[str, bool] | None = None,
        policy_contents: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """
        Run policy checks on content.
        
        Args:
            url: Page URL
            text: Page text content
            title: Page title
            policy_pages: Dict of detected policy page links (from crawler)
            policy_contents: Dict of text content from policy pages
            
        Returns:
            Policy check results with violations and score
        """
        logger.info("Running policy check", url=url)
        
        combined_text = f"{title} {text}"
        
        # Detect jurisdiction
        jurisdiction = self._detect_jurisdiction(url)
        
        # Detect content categories
        categories = self._detect_categories(combined_text)
        
        # Scan for restricted content
        violations = self._scan_for_violations(combined_text)
        
        # Check policy pages (privacy, terms, contact)
        policy_pages = policy_pages or {}
        policy_contents = policy_contents or {}
        has_privacy = policy_pages.get("privacy", False)
        has_terms = policy_pages.get("terms", False)
        has_contact = policy_pages.get("contact", False)
        has_about = policy_pages.get("about", False)
        
        # Validate policy page content quality
        content_validation = {}
        for ptype, ptext in policy_contents.items():
            content_validation[ptype] = self._validate_policy_content(ptype, ptext)
            
            # If content is too thin, flag it
            if not content_validation[ptype]["is_valid"]:
                violations.append({
                    "type": f"thin_{ptype}_content",
                    "description": f"{ptype.capitalize()} page has insufficient content ({content_validation[ptype]['word_count']} words)",
                    "severity": "medium",
                    "google_policy": "Policy transparency requirement",
                })
            
            # If privacy policy is missing GDPR/CCPA disclosures
            if ptype == "privacy":
                if not content_validation[ptype]["has_gdpr"]:
                    violations.append({
                        "type": "missing_gdpr_disclosure",
                        "description": "Privacy policy missing GDPR disclosures",
                        "severity": "low",
                        "google_policy": "GDPR compliance",
                    })
                if not content_validation[ptype]["has_ccpa"]:
                    violations.append({
                        "type": "missing_ccpa_disclosure",
                        "description": "Privacy policy missing CCPA disclosures",
                        "severity": "low",
                        "google_policy": "CCPA compliance",
                    })
        
        # Flag missing required policy pages
        if not has_privacy:
            violations.append({
                "type": "missing_privacy_policy",
                "description": "No privacy policy page detected",
                "severity": "medium",
                "google_policy": "Privacy disclosure requirement",
            })
        if not has_terms:
            violations.append({
                "type": "missing_terms",
                "description": "No terms of service page detected",
                "severity": "low",
                "google_policy": "Legal pages recommended",
            })
        
        # Calculate compliance score
        compliance_score = self._calculate_compliance_score(violations)
        
        return {
            "jurisdiction": jurisdiction,
            "categories": categories,
            "violations": violations,
            "violation_count": len(violations),
            "compliance_score": round(compliance_score, 2),
            "risk_level": self._get_risk_level(compliance_score),
            "requires_review": any(
                v["severity"] in ["critical", "high"] for v in violations
            ),
            # Policy page status
            "policy_pages": {
                "privacy": has_privacy,
                "terms": has_terms,
                "contact": has_contact,
                "about": has_about,
            },
            "content_validation": content_validation,
        }
    
    def _validate_policy_content(self, ptype: str, text: str) -> dict[str, Any]:
        """Validate the quality and disclosures of a policy page."""
        if not text:
            return {"is_valid": False, "word_count": 0, "has_gdpr": False, "has_ccpa": False}
            
        words = text.split()
        word_count = len(words)
        
        # Minimum word count threshold (reject < 200 words as "thin")
        is_valid = word_count >= 200
        
        # GDPR Keywords
        gdpr_keywords = [
            r"GDPR", r"General Data Protection Regulation", r"European Union",
            r"Data Protection Officer", r"DPO", r"Right to Access", r"Right to Erasure"
        ]
        has_gdpr = any(re.search(k, text, re.I) for k in gdpr_keywords)
        
        # CCPA Keywords
        ccpa_keywords = [
            r"CCPA", r"California Consumer Privacy Act", r"California Resident",
            r"Do Not Sell My Personal Information", r"Shine the Light"
        ]
        has_ccpa = any(re.search(k, text, re.I) for k in ccpa_keywords)
        
        return {
            "is_valid": is_valid,
            "word_count": word_count,
            "has_gdpr": has_gdpr,
            "has_ccpa": has_ccpa,
        }
    
    def _detect_jurisdiction(self, url: str) -> dict[str, Any]:
        """Detect likely jurisdiction from URL."""
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.lower()
            
            # Check TLD
            for tld, country in TLD_JURISDICTION.items():
                if domain.endswith(tld):
                    return {
                        "country": country,
                        "detected_from": "tld",
                        "domain": domain,
                    }
            
            # Default to US for .com and unknown
            return {
                "country": "US",
                "detected_from": "default",
                "domain": domain,
            }
        except Exception:
            return {"country": "Unknown", "detected_from": "error"}
    
    def _detect_categories(self, text: str) -> list[str]:
        """Categorize content based on keywords."""
        categories = []
        text_sample = text[:5000]  # First 5000 chars
        
        for category, patterns in self._category_patterns.items():
            matches = sum(1 for p in patterns if p.search(text_sample))
            if matches >= 2:  # Require at least 2 matches
                categories.append(category)
        
        return categories if categories else ["general"]
    
    def _scan_for_violations(self, text: str) -> list[dict[str, Any]]:
        """Scan text for policy violations."""
        violations = []
        text_sample = text[:10000]  # First 10000 chars
        
        for category, data in self._restricted_patterns.items():
            for pattern in data["patterns"]:
                matches = pattern.findall(text_sample)
                if matches:
                    violations.append({
                        "category": category,
                        "severity": data["severity"],
                        "match_count": len(matches),
                        "sample": matches[0] if matches else "",
                    })
                    break  # One match per category is enough
        
        return violations
    
    def _calculate_compliance_score(self, violations: list[dict[str, Any]]) -> float:
        """Calculate compliance score (0-100, higher is better)."""
        score = 100.0
        
        for violation in violations:
            severity = violation["severity"]
            if severity == "critical":
                score -= 40
            elif severity == "high":
                score -= 25
            elif severity == "medium":
                score -= 10
            else:
                score -= 5
        
        return max(0, score)
    
    def _get_risk_level(self, compliance_score: float) -> str:
        """Map compliance score to risk level (inverted)."""
        if compliance_score >= 90:
            return "low"
        elif compliance_score >= 60:
            return "medium"
        else:
            return "high"
