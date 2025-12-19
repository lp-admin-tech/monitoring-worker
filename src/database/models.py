"""
Pydantic models for database tables and API responses.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


# ============== Database Models ==============

class Publisher(BaseModel):
    """Publisher record from publishers table."""
    id: UUID
    name: str
    site_name: str | None = None
    site_url: str | None = None
    gam_status: str | None = None
    partner_id: UUID | None = None
    created_at: datetime | None = None


class SiteAudit(BaseModel):
    """Site audit record from site_audits table."""
    id: UUID
    publisher_id: UUID
    site_name: str
    status: str = "pending"
    
    # Scores
    risk_score: float | None = None
    mfa_probability: float | None = None
    risk_level: str | None = None
    
    # Analysis results
    crawler_data: dict[str, Any] | None = None
    content_analysis: dict[str, Any] | None = None
    ad_analysis: dict[str, Any] | None = None
    technical_check: dict[str, Any] | None = None
    policy_check: dict[str, Any] | None = None
    ai_report: dict[str, Any] | None = None
    
    # Metadata
    is_directory: bool = False
    data_quality_score: float | None = None
    
    # Timestamps
    created_at: datetime | None = None
    completed_at: datetime | None = None


class AuditJob(BaseModel):
    """Audit job from audit_job_queue table."""
    id: UUID
    publisher_id: UUID
    sites: list[dict[str, str]]
    status: str = "pending"
    triggered_by: str | None = None
    priority: str = "normal"
    
    queued_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None


# ============== API Models ==============

class AuditRequest(BaseModel):
    """Request to trigger an audit."""
    publisher_id: str
    site_url: str | None = None
    site_name: str | None = None
    priority: str = "normal"
    triggered_by: str = "api"


class AuditResponse(BaseModel):
    """Response from audit trigger."""
    task_id: str
    status: str
    message: str


class AuditResult(BaseModel):
    """Complete audit result."""
    audit_id: str
    publisher_id: str
    site_url: str
    
    risk_score: float
    mfa_probability: float
    risk_level: str
    
    content_analysis: dict[str, Any]
    ad_analysis: dict[str, Any]
    technical_check: dict[str, Any]
    policy_check: dict[str, Any]
    
    ai_report: dict[str, Any] | None = None
    is_directory: bool = False
    trend: dict[str, Any] | None = None
    
    data_quality_score: float | None = None
    completed_at: datetime | None = None


# ============== Internal Models ==============

class CrawlResult(BaseModel):
    """Result of crawling a page."""
    url: str
    html: str = ""
    markdown: str = ""
    text: str = ""
    title: str = ""
    
    # Network
    requests: list[dict[str, Any]] = Field(default_factory=list)
    ad_requests: list[dict[str, Any]] = Field(default_factory=list)
    
    # Metrics
    load_time_ms: float = 0
    total_requests: int = 0
    
    # Media
    screenshot_base64: str | None = None
    
    # Elements
    links: list[dict[str, str]] = Field(default_factory=list)
    images: list[dict[str, str]] = Field(default_factory=list)
    iframes: list[dict[str, str]] = Field(default_factory=list)
    scripts: list[str] = Field(default_factory=list)
    ad_elements: list[dict[str, Any]] = Field(default_factory=list)
    
    # Error
    error: str | None = None


class RiskResult(BaseModel):
    """Result of risk scoring."""
    risk_score: float
    mfa_probability: float
    risk_level: str
    component_risks: dict[str, float]
    data_quality_score: float = 0


class ContentAnalysisResult(BaseModel):
    """Result of content analysis."""
    word_count: int = 0
    sentence_count: int = 0
    readability: dict[str, float] = Field(default_factory=dict)
    entropy: float = 0
    clickbait_score: float = 0
    thin_content: dict[str, Any] = Field(default_factory=dict)
    ai_likelihood: float = 0
    quality_score: float = 0
    risk_level: str = "unknown"


class AdAnalysisResult(BaseModel):
    """Result of ad analysis."""
    ad_count: int = 0
    ad_request_count: int = 0
    ad_iframe_count: int = 0
    density: dict[str, Any] = Field(default_factory=dict)
    ad_networks: list[str] = Field(default_factory=list)
    suspicious_patterns: list[dict[str, Any]] = Field(default_factory=list)
    risk_score: float = 0
    risk_level: str = "unknown"


class TechnicalCheckResult(BaseModel):
    """Result of technical checks."""
    ssl: dict[str, Any] = Field(default_factory=dict)
    ads_txt: dict[str, Any] = Field(default_factory=dict)
    performance: dict[str, Any] = Field(default_factory=dict)
    health_score: float = 0
    risk_level: str = "unknown"


class PolicyCheckResult(BaseModel):
    """Result of policy check."""
    jurisdiction: dict[str, Any] = Field(default_factory=dict)
    categories: list[str] = Field(default_factory=list)
    violations: list[dict[str, Any]] = Field(default_factory=list)
    violation_count: int = 0
    compliance_score: float = 100
    risk_level: str = "low"
    requires_review: bool = False
