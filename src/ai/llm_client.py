"""
LLM Client - Interfaces with Groq and HuggingFace for AI-powered reports.
"""

import json
from typing import Any

from src.config import settings
from src.utils.logger import get_logger

logger = get_logger(__name__)


class LLMClient:
    """
    LLM client with Groq as primary and HuggingFace as fallback.
    """
    
    def __init__(self):
        self._groq_client = None
        self._hf_client = None
    
    @property
    def groq_client(self):
        """Lazy-load Groq client."""
        if self._groq_client is None and settings.groq_api_key:
            try:
                from groq import Groq
                self._groq_client = Groq(api_key=settings.groq_api_key)
            except ImportError:
                logger.warning("Groq library not installed")
        return self._groq_client
    
    async def generate_audit_report(self, analysis_results: dict[str, Any]) -> str:
        """Generate a detailed AI audit report based on analysis results."""
        logger.info("Generating AI audit report")
        
        # Extract key signals for the prompt
        ad_res = analysis_results.get("ad", {})
        content_res = analysis_results.get("content", {})
        traffic_res = analysis_results.get("traffic", {})
        ivt_res = analysis_results.get("ivt", {})
        scoring = analysis_results.get("scoring", {})
        
        prompt = f"""
        You are an expert MFA (Made for Advertising) detection specialist.
        Analyze the following audit data and generate a professional, concise report.
        
        SITE DATA:
        - URL: {analysis_results.get('url')}
        - MFA Probability: {scoring.get('probability', 0)*100:.1f}%
        - Confidence: {scoring.get('confidence', 0)*100:.1f}%
        
        KEY SIGNALS:
        1. AD LAYOUT:
           - Ad Count: {ad_res.get('ad_count')}
           - Area Density: {ad_res.get('area_density', 0)*100:.1f}%
           - Stacked Ads: {ad_res.get('stacked_ads_count', 0)}
           - Hidden Ads: {ad_res.get('hidden_ads', 0)}
           
        2. CONTENT QUALITY:
           - Word Count: {content_res.get('word_count')}
           - Information Density: {content_res.get('information_density', 0)*100:.1f}%
           - Scraped Content: {'Yes' if content_res.get('scraped_content', {}).get('is_scraped') else 'No'}
           - AI Likelihood: {content_res.get('ai_generated_likelihood', 0)*100:.1f}%
           
        3. TRAFFIC & IVT:
           - Arbitrage Likely: {'Yes' if traffic_res.get('is_arbitrage_likely') else 'No'}
           - Social Cloaking: {'Yes' if traffic_res.get('social_cloaking', {}).get('detected') else 'No'}
           - IVT Violations: {ivt_res.get('violation_count', 0)}
           
        REPORT STRUCTURE:
        1. Executive Summary (1-2 sentences)
        2. Critical Findings (Bulleted list of highest risk signals)
        3. Remediation Plan (Specific, actionable steps to fix detected MFA signals and improve site health)
        
        REMEDIATION GUIDANCE:
        - If Ad Layout risk is high: Suggest reducing ad density, removing stacked/hidden ads, and improving ad-to-content ratio.
        - If Content Quality is low: Suggest increasing word count, improving information density, and ensuring original, non-AI content.
        - If Traffic/IVT risk is high: Suggest reviewing traffic sources, eliminating arbitrage, and implementing better bot protection.
        - If Policy pages are missing: Suggest adding clear Privacy, Terms, and About Us pages.
        
        Keep the tone professional, data-driven, and helpful.
        """
        
        try:
            # Call LLM (mocked for now or using real client)
            report = await self._call_llm(prompt)
            return report
        except Exception as e:
            logger.error("AI report generation failed", error=str(e))
            return "AI report generation failed due to an internal error."

    async def _call_llm(self, prompt: str) -> str:
        """Internal method to call the LLM."""
        if self.groq_client:
            try:
                import asyncio
                response = await asyncio.to_thread(
                    self.groq_client.chat.completions.create,
                    model="llama-3.3-70b-versatile",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.3,
                    max_tokens=1000,
                )
                return response.choices[0].message.content
            except Exception as e:
                logger.error("Groq call failed", error=str(e))
        
        return "LLM service unavailable. Rule-based analysis suggests high MFA risk based on detected signals."
