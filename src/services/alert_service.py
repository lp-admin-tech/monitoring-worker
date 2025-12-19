"""
Alert Service - Creates alerts based on audit results.
Integrates with existing Supabase alerts table.
"""

from typing import Any
from enum import Enum

from src.utils.logger import get_logger
from src.database.client import db

logger = get_logger(__name__)


class AlertType(str, Enum):
    """Standard alert types for MFA detection."""
    MFA_HIGH = "mfa_high"
    IVT_RISK = "ivt_risk"
    POLICY_VIOLATION = "policy_violation"
    CTR_SUSPICIOUS = "ctr_suspicious"
    ECPM_LOW = "ecpm_low"
    VIEWABILITY_LOW = "viewability_low"
    TRAFFIC_ARBITRAGE = "traffic_arbitrage"
    PUBLISHER_REJECTED = "publisher_rejected"
    CLOSED_IVT = "closed_ivt"
    CLOSED_POLICY = "closed_policy"


class Severity(str, Enum):
    """Alert severity levels."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


# Thresholds for automatic alert generation
ALERT_THRESHOLDS = {
    AlertType.MFA_HIGH: {"threshold": 0.5, "severity": Severity.HIGH},
    AlertType.IVT_RISK: {"threshold": 0.5, "severity": Severity.CRITICAL},
    AlertType.POLICY_VIOLATION: {"threshold": 1, "severity": Severity.CRITICAL},
    AlertType.CTR_SUSPICIOUS: {"threshold": 0.015, "severity": Severity.MEDIUM},
    AlertType.ECPM_LOW: {"threshold": 1.0, "severity": Severity.MEDIUM},
    AlertType.VIEWABILITY_LOW: {"threshold": 50, "severity": Severity.MEDIUM},
    AlertType.TRAFFIC_ARBITRAGE: {"threshold": 0.4, "severity": Severity.HIGH},
}

# Alert types that should trigger emails (critical events)
EMAIL_ALERT_TYPES = [
    AlertType.IVT_RISK,
    AlertType.POLICY_VIOLATION,
    AlertType.PUBLISHER_REJECTED,
    AlertType.CLOSED_IVT,
    AlertType.CLOSED_POLICY,
]


class AlertService:
    """
    Service for creating and managing alerts.
    
    Integrates with:
    - Supabase alerts table (persistent)
    - Email notifications (for critical alerts)
    """
    
    async def create_alert(
        self,
        publisher_id: str,
        alert_type: AlertType,
        severity: Severity,
        title: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> str | None:
        """
        Create a new alert.
        
        Args:
            publisher_id: Publisher UUID
            alert_type: Type of alert
            severity: Severity level
            title: Alert title
            message: Alert message
            details: Additional data
            
        Returns:
            Alert ID or None if failed
        """
        try:
            result = db.client.table("alerts").insert({
                "publisher_id": publisher_id,
                "type": alert_type.value,
                "alert_type": alert_type.value,  # New column
                "severity": severity.value,
                "title": title,
                "message": message,
                "details": details or {},
                "status": "active",
            }).execute()
            
            alert_id = result.data[0]["id"] if result.data else None
            
            logger.info(
                "Alert created",
                alert_id=alert_id,
                publisher_id=publisher_id,
                alert_type=alert_type.value,
                severity=severity.value,
            )
            
            return alert_id
            
        except Exception as e:
            logger.error("Failed to create alert", error=str(e))
            return None
    
    async def check_and_create_alerts(
        self,
        publisher_id: str,
        audit_result: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """
        Check audit results and create appropriate alerts.
        
        Args:
            publisher_id: Publisher UUID
            audit_result: Complete audit result data
            
        Returns:
            List of created alert IDs
        """
        created_alerts = []
        
        # Check MFA score
        mfa_probability = audit_result.get("mfa_probability", 0)
        if mfa_probability >= ALERT_THRESHOLDS[AlertType.MFA_HIGH]["threshold"]:
            alert_id = await self.create_alert(
                publisher_id=publisher_id,
                alert_type=AlertType.MFA_HIGH,
                severity=Severity.HIGH,
                title="High MFA Risk Detected",
                message=f"MFA probability is {mfa_probability*100:.1f}% (threshold: 50%)",
                details={"mfa_probability": mfa_probability},
            )
            if alert_id:
                created_alerts.append(alert_id)
        
        # Check IVT risk
        ivt_data = audit_result.get("ivt_analysis", {})
        ivt_risk = ivt_data.get("ivt_risk_score", 0)
        if ivt_risk >= ALERT_THRESHOLDS[AlertType.IVT_RISK]["threshold"]:
            alert_id = await self.create_alert(
                publisher_id=publisher_id,
                alert_type=AlertType.IVT_RISK,
                severity=Severity.CRITICAL,
                title="⚠️ Account Closure Risk - Invalid Traffic",
                message=f"IVT risk score is {ivt_risk*100:.1f}%. Immediate action required.",
                details=ivt_data,
            )
            if alert_id:
                created_alerts.append(alert_id)
        
        # Check policy violations
        policy_data = audit_result.get("policy_check", {})
        violations = policy_data.get("violations", [])
        critical_violations = [v for v in violations if v.get("severity") == "critical"]
        if critical_violations:
            alert_id = await self.create_alert(
                publisher_id=publisher_id,
                alert_type=AlertType.POLICY_VIOLATION,
                severity=Severity.CRITICAL,
                title="⚠️ Policy Violation Detected",
                message=f"Found {len(critical_violations)} critical policy violation(s)",
                details={"violations": critical_violations},
            )
            if alert_id:
                created_alerts.append(alert_id)
        
        # Check CTR
        gam_data = audit_result.get("gam_analysis", {})
        avg_ctr = gam_data.get("metrics", {}).get("average_ctr", 0)
        if avg_ctr >= ALERT_THRESHOLDS[AlertType.CTR_SUSPICIOUS]["threshold"]:
            alert_id = await self.create_alert(
                publisher_id=publisher_id,
                alert_type=AlertType.CTR_SUSPICIOUS,
                severity=Severity.MEDIUM,
                title="Suspicious CTR Detected",
                message=f"CTR is {avg_ctr*100:.2f}% (industry avg: 0.46%)",
                details={"ctr": avg_ctr},
            )
            if alert_id:
                created_alerts.append(alert_id)
        
        # Check eCPM
        avg_ecpm = gam_data.get("metrics", {}).get("average_ecpm", 10)
        if avg_ecpm < ALERT_THRESHOLDS[AlertType.ECPM_LOW]["threshold"]:
            alert_id = await self.create_alert(
                publisher_id=publisher_id,
                alert_type=AlertType.ECPM_LOW,
                severity=Severity.MEDIUM,
                title="Low eCPM Detected",
                message=f"eCPM is ${avg_ecpm:.2f} (threshold: $1.00)",
                details={"ecpm": avg_ecpm},
            )
            if alert_id:
                created_alerts.append(alert_id)
        
        # Check traffic arbitrage
        arbitrage_data = audit_result.get("arbitrage_analysis", {})
        arbitrage_risk = arbitrage_data.get("summary", {}).get("combined_risk_score", 0)
        if arbitrage_risk >= ALERT_THRESHOLDS[AlertType.TRAFFIC_ARBITRAGE]["threshold"]:
            alert_id = await self.create_alert(
                publisher_id=publisher_id,
                alert_type=AlertType.TRAFFIC_ARBITRAGE,
                severity=Severity.HIGH,
                title="Traffic Arbitrage Detected",
                message=f"Traffic arbitrage risk: {arbitrage_risk*100:.1f}%",
                details=arbitrage_data.get("crawl_analysis", {}),
            )
            if alert_id:
                created_alerts.append(alert_id)
        
        logger.info(
            "Alert check complete",
            publisher_id=publisher_id,
            alerts_created=len(created_alerts),
        )
        
        return created_alerts
    
    def should_send_email(self, alert_type: AlertType) -> bool:
        """Check if alert type should trigger email notification."""
        return alert_type in EMAIL_ALERT_TYPES


# Convenience instance
alert_service = AlertService()
